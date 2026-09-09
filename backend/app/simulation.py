"""Monte Carlo pit-strategy simulation.

Implements simulation-logic.md steps 0-6 against a `RaceBaseline` loaded from the
Postgres cache. The asymmetry that shapes the whole module: **compound is known only
for the hypothetical strategy**, because the user picked it. The baseline side has no
compound model at all - it is the driver's recorded `lap_time_seconds` values, used
as-is. So this compares a modeled strategy against recorded reality, not two models.

What the compound table no longer does is set the *magnitude* of tire falloff. That is
measured per driver per race from their own lap times by `app.pace_model` (Step 0) and
reaches this module on `baseline.pace_model`; the table is demoted to supplying the
*ratio* between compounds, plus the fresh-tire pace offsets, plus the tier-4 fallback
for a race with no fit. We still never assert which compound produced a real stint.

Nothing here touches the database or the network; it takes a baseline in and returns
a `SimulationResponse`.
"""

from __future__ import annotations

import random
from bisect import bisect_left
from dataclasses import dataclass, replace
from statistics import fmean, median

from app.pace_model import (
    CONDITIONS_MIXED,
    DEFAULT_FUEL_EFFECT,
    QUALITY_GOOD,
    QUALITY_SPARSE,
    RacePaceModel,
    segment_stints,
)
from app.repository import RaceBaseline
from app.schemas import (
    COMPOUNDS,
    LapComparison,
    PaceModelInfo,
    SimulationRequest,
    SimulationResponse,
    SimulationSummary,
    StrategyStop,
)

__all__ = ["InvalidStrategyError", "UnsupportedConditionsError", "run_simulation"]


class InvalidStrategyError(ValueError):
    """The request can't be simulated. Surfaces as a 400."""


class UnsupportedConditionsError(RuntimeError):
    """The *race* can't be simulated - wet/mixed conditions. Surfaces as a 409.

    Distinct from `InvalidStrategyError` on purpose: nothing about the user's strategy
    is wrong, so the frontend must say "we can't model this race" rather than "fix your
    pit laps". See api-contract.md.
    """


# --- Step 1: tire degradation model ---------------------------------------
# (lap-time offset vs. the driver's own fresh-tire pace, degradation seconds per lap).
# The offsets stay absolute: they are a pace delta, and nothing in the lap data isolates
# them. The degradation column is now used two ways - as the ratio between compounds for
# tiers 1-3, and as the absolute fallback for tier 4.
COMPOUND_MODEL: dict[str, tuple[float, float]] = {
    "soft": (-0.30, 0.080),
    "medium": (0.00, 0.050),
    "hard": (0.40, 0.030),
    "intermediate": (2.00, 0.060),
    "wet": (5.00, 0.040),
}

# The opening stint's compound is unknowable: the user only picks what goes *on* at
# each stop. Medium is the neutral assumption, and it is the model's zero point.
STARTING_COMPOUND = "medium"

# Step F: compound as a multiplier on the derived degradation, normalised so that the
# medium tire is 1.0. Derived from COMPOUND_MODEL rather than written out again, so the
# ratios can never drift from the absolute values the tier-4 fallback still uses.
COMPOUND_DEGRADATION_MULTIPLIER: dict[str, float] = {
    compound: degradation / COMPOUND_MODEL[STARTING_COMPOUND][1]
    for compound, (_offset, degradation) in COMPOUND_MODEL.items()
}

# --- Step G: extrapolating past the observed envelope ---------------------
# Past the longest stint anyone ran in this race, degradation stops being linear and
# picks up a quadratic excess term.
#
# Scaled off the *field median* degradation, not the driver's own slope. Scaling it off
# the driver was self-defeating: a car the fit flattered at 0.004 s/lap got an
# extrapolation penalty of roughly zero, so the one case the term exists for - a stint
# far longer than anyone actually ran - came out free for exactly the cars whose slope
# we trust least. The cliff is a property of the tire and the circuit, which the field
# shares; how fast a car walks toward it is what the linear term is for.
# Still a judgement call, not calibrated against a real long-stint race.
EXCESS_CURVATURE = 0.35

# --- Floor on the derived degradation --------------------------------------
# A fitted slope near zero is a measurement artefact, not a car that does not wear its
# tires: one-sided outlier trimming shaves the slow end off a stint, and a driver who
# spent it managing pace leaves no falloff to measure. Taken literally it says a 47-lap
# Monza stint costs nothing, which beat the same car's real two-stop race by 11 seconds.
#
# So the derived number is floored at whichever is largest:
#   - the fitted slope itself (the floor never lowers an honest measurement),
#   - half the field median for this race (circuit- and day-specific), and
#   - an absolute minimum, for a race where the whole field fitted flat.
DEGRADATION_FLOOR_FIELD_SHARE = 0.5
DEGRADATION_FLOOR_ABSOLUTE = 0.020
# How much less we trust the slope outside the observed range. 1.5x between the
# driver's own longest stint and the field's, then growing per lap beyond that.
UNOBSERVED_STDERR_INFLATION = 1.5
BEYOND_EVIDENCE_STDERR_GROWTH = 0.1
# A fit with no data behind it still has to express *some* doubt, or 500 Monte Carlo
# runs of the generic table produce a suspiciously tight distribution.
GENERIC_DEGRADATION_STDERR = 0.02
# A stint fitted from 5-7 laps is usable, but not as trustworthy as one from 8+.
SPARSE_STDERR_INFLATION = 1.5
# Tier 3 is a race-wide number applied to a specific car, so widen it further.
FIELD_MEDIAN_STDERR_INFLATION = 2.0

# --- Step 2: pit stop penalty ---------------------------------------------
PIT_PENALTY_RANGE = (20.0, 25.0)
# Real durations above this are problem stops (Monza 2024: hulkenberg 38.875), not the
# circuit's pit-lane loss. Sampling them would model a botched stop as the norm.
CLEAN_STOP_CEILING = 40.0
MIN_CLEAN_STOPS = 5

# --- Step 5: safety car ----------------------------------------------------
DEFAULT_SAFETY_CAR_PROBABILITY = 0.30
SAFETY_CAR_PROBABILITY: dict[str, float] = {
    "marina_bay": 0.80,
    "monaco": 0.70,
    "jeddah": 0.70,
    "baku": 0.65,
    "villeneuve": 0.65,
    "vegas": 0.55,
    "albert_park": 0.50,
    "interlagos": 0.50,
    "imola": 0.45,
    "miami": 0.45,
    "rodriguez": 0.45,
    "spa": 0.45,
    "red_bull_ring": 0.40,
    "suzuka": 0.40,
    "americas": 0.35,
    "bahrain": 0.35,
    "losail": 0.35,
    "shanghai": 0.35,
    "silverstone": 0.35,
    "yas_marina": 0.35,
    "zandvoort": 0.35,
    "monza": 0.30,
    "hungaroring": 0.25,
    "catalunya": 0.20,
}
# A stop taken under a safety car costs much less relative to the field.
SAFETY_CAR_DISCOUNT_RANGE = (15.0, 18.0)
# ...but never nothing: the driver still drives the pit lane.
MIN_EFFECTIVE_PIT_LOSS = 5.0

# Laps this much slower than the driver's raw median are safety-car, traffic or
# pit-affected, and don't represent green-flag pace.
GREEN_FLAG_TOLERANCE = 1.07


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def validate_strategy(strategy: list[StrategyStop], total_laps: int) -> None:
    """Contract's 400 cases: pit lap outside race length, unknown compound."""
    seen: set[int] = set()
    for stop in strategy:
        if stop.compound_in not in COMPOUNDS:
            raise InvalidStrategyError(
                f"Unknown compound {stop.compound_in!r}. Expected one of: "
                f"{', '.join(COMPOUNDS)}."
            )
        if not 1 <= stop.lap <= total_laps:
            raise InvalidStrategyError(
                f"Pit lap {stop.lap} is outside the race length (1-{total_laps})."
            )
        if stop.lap in seen:
            raise InvalidStrategyError(f"Two pit stops on the same lap ({stop.lap}).")
        seen.add(stop.lap)


# ---------------------------------------------------------------------------
# Step 1 helpers - pace and tire age
# ---------------------------------------------------------------------------


def _tire_age_by_lap(total_laps: int, pit_laps: set[int]) -> dict[int, int]:
    """Laps already on the current set at the start of each lap.

    A stop on lap L happens during lap L, so L is driven on the old set and L+1 is the
    first lap on the new one.
    """
    ages: dict[int, int] = {}
    age = 0
    for lap in range(1, total_laps + 1):
        ages[lap] = age
        age = 0 if lap in pit_laps else age + 1
    return ages


def _fuel_corrected_base_pace(
    lap_times: dict[int, float],
    pit_laps: set[int],
    neutralized: set[int],
    fuel_effect: float,
    degradation: float,
    final_lap: int,
) -> float | None:
    """The driver's fresh-tire pace at lap 0, from their own laps.

    Used when the joint fit produced no intercept for this driver - they retired too
    early, or every stint fell below the quality gate. Each usable lap is corrected back
    to a common reference (`t + fuel * lap - degradation * age`) and the median taken,
    so it is the same quantity the fitted intercept is, just measured with a borrowed
    degradation instead of one of their own.

    Returns None when the driver has no usable lap at all.
    """
    ages = _tire_age_by_lap(final_lap, pit_laps)
    corrected = [
        seconds + fuel_effect * lap - degradation * ages.get(lap, 0)
        for lap, seconds in lap_times.items()
        if lap != 1
        and lap not in pit_laps
        and lap - 1 not in pit_laps
        and lap not in neutralized
    ]
    if not corrected:
        # Last resort: every lap they ran was an in-lap, an out-lap or neutralized.
        corrected = [
            seconds + fuel_effect * lap for lap, seconds in lap_times.items() if lap != 1
        ]
    if not corrected:
        return None
    raw = median(corrected)
    # Traffic and mistakes only ever slow a lap down, so trim one-sided.
    clean = [value for value in corrected if value <= raw * GREEN_FLAG_TOLERANCE]
    return median(clean) if clean else raw


@dataclass(frozen=True)
class Degradation:
    """A degradation estimate plus where in the fallback chain it came from."""

    per_lap: float
    stderr: float
    tier: int
    source: str  # driver | team-mate | field | generic
    source_driver_id: str | None
    # The physical floor `per_lap` was held at, so the Monte Carlo resampling can be
    # held at the same place rather than sampling its way back under it.
    floor: float = 0.0
    # True when the floor is what produced `per_lap` - i.e. the fitted slope was lower.
    # Reported to the caller: a floored number is a bound, not a measurement.
    floored: bool = False


def _driver_degradation(
    model: RacePaceModel, driver_id: str, tier: int, source: str
) -> Degradation | None:
    """The `laps_used`-weighted mean of one driver's fitted stints, or None.

    Good stints are preferred outright. A driver with only sparse ones still gets an
    answer - the design calls sparse "usable, but with inflated stderr" - rather than
    dropping a tier for the sake of three missing laps.
    """
    for quality, inflation in ((QUALITY_GOOD, 1.0), (QUALITY_SPARSE, SPARSE_STDERR_INFLATION)):
        stints = [
            stint
            for stint in model.stints
            if stint.driver_id == driver_id
            and stint.quality == quality
            and stint.degradation_per_lap is not None
            and stint.laps_used > 0
        ]
        if not stints:
            continue
        weight = sum(stint.laps_used for stint in stints)
        per_lap = sum(s.degradation_per_lap * s.laps_used for s in stints) / weight
        # Independent stints, so the weighted mean's variance is the weighted sum of
        # theirs. One long stint therefore buys more confidence than two short ones.
        variance = sum(((s.degradation_stderr or 0.0) * s.laps_used) ** 2 for s in stints)
        return Degradation(
            per_lap=per_lap,
            stderr=(variance**0.5 / weight) * inflation,
            tier=tier,
            source=source,
            source_driver_id=driver_id,
        )
    return None


def _field_stderr(model: RacePaceModel) -> float:
    errors = [
        stint.degradation_stderr
        for stint in model.stints
        if stint.quality == QUALITY_GOOD and stint.degradation_stderr is not None
    ]
    base = median(errors) if errors else GENERIC_DEGRADATION_STDERR
    return base * FIELD_MEDIAN_STDERR_INFLATION


def _degradation_floor(model: RacePaceModel | None) -> float:
    """The smallest degradation this race is willing to believe in.

    Half the field median where there is one - a car really can be gentler on its tires
    than the field, just not by an order of magnitude - and an absolute minimum
    otherwise, for a race where the fit came back flat across the board.
    """
    field = None if model is None else model.field_median_degradation
    share = 0.0 if field is None else DEGRADATION_FLOOR_FIELD_SHARE * field
    return max(DEGRADATION_FLOOR_ABSOLUTE, share)


def _floored(estimate: Degradation, floor: float) -> Degradation:
    """`estimate` held at `floor`, recording that the floor is what answered."""
    if estimate.per_lap >= floor:
        return replace(estimate, floor=floor, floored=False)
    return replace(estimate, per_lap=floor, floor=floor, floored=True)


def resolve_degradation(baseline: RaceBaseline, driver_id: str) -> Degradation:
    """Step E: driver -> team-mate -> field median -> generic compound table.

    First hit wins, and which tier answered is reported to the caller: a tier-4 number
    and a tier-1 number deserve very different confidence in the UI.

    `per_lap` is always a medium-equivalent magnitude, whichever tier produced it - the
    compound multiplier is applied later, in `PaceModel.effective_degradation`.

    Whatever the tier returns is then floored (`_degradation_floor`). The floor applies
    to every tier on purpose: a near-zero answer is no more believable because it was
    measured off a team-mate than off the driver themselves.

    Note the floor is recorded on the estimate as well as applied to it. It has to be
    applied *again* after the compound ratio - see `PaceModel.effective_degradation` -
    or a hard tire keeps only 60% of the bound.
    """
    model = baseline.pace_model
    floor = _degradation_floor(model)
    if model is not None:
        own = _driver_degradation(model, driver_id, tier=1, source="driver")
        if own is not None:
            return _floored(own, floor)

        # Tier 2. The team-mate ran the same car on the same track on the same day,
        # which beats a generic curve even though team-mates genuinely differ in tire
        # management. Pick the one with the most evidence behind them.
        candidates = [
            estimate
            for mate in baseline.team_mates(driver_id)
            if (estimate := _driver_degradation(model, mate, tier=2, source="team-mate"))
            is not None
        ]
        if candidates:
            return _floored(min(candidates, key=lambda estimate: estimate.stderr), floor)

        if model.field_median_degradation is not None:
            return _floored(
                Degradation(
                    per_lap=model.field_median_degradation,
                    stderr=_field_stderr(model),
                    tier=3,
                    source="field",
                    source_driver_id=None,
                ),
                floor,
            )

    return _floored(
        Degradation(
            per_lap=COMPOUND_MODEL[STARTING_COMPOUND][1],
            stderr=GENERIC_DEGRADATION_STDERR,
            tier=4,
            source="generic",
            source_driver_id=None,
        ),
        floor,
    )


@dataclass(frozen=True)
class PaceModel:
    """Lap time as a function of lap number, tire age and compound.

    `lap_time = pace_at_lap_zero - fuel_effect * lap + offset + effective_deg * age`

    No centring hack any more. The old model started from the driver's median lap time,
    which already had real degradation baked into it, so `deg * age` had to be measured
    against their average tire age or every hypothetical strategy came out slower for
    free. `pace_at_lap_zero` is a *fitted* fresh-tire pace, so degradation is added from
    zero and the compound comparison is no longer skewed toward whatever the driver
    happened to run.
    """

    pace_at_lap_zero: float
    fuel_effect: float
    degradation: Degradation
    # What the Step G excess term is scaled off: the field's median falloff in this
    # race, not this car's. The cliff belongs to the tire and the circuit.
    field_degradation: float
    # Step G envelopes: the longest tire age this driver reached, and the longest any
    # driver reached, in this race.
    max_driver_age: int
    max_race_age: int

    def effective_degradation(
        self, compound: str, degradation: float, floor: float = 0.0
    ) -> float:
        """Step F: the derived magnitude, scaled by the compound's ratio, then floored.

        Tier 4 needs no special case. Its `degradation` is the table's own medium value
        and the multipliers are that table normalised by it, so this reproduces the
        generic absolute numbers exactly - and, unlike a direct table lookup, still
        responds to the Monte Carlo resampling instead of being a fixed constant.

        **The floor lands here, after the compound ratio, not before it.** Applying it to
        the medium-equivalent magnitude and then scaling that down left the floor doing
        60% of its job on a hard tire and 160% of it on a soft one - so the bound that is
        supposed to stop an unsurvivable stint coming out free went missing on exactly
        the compound long stints are run on. A 47-lap Monza stint reached the flag having
        lost 0.8s of pace on hards against 2.2s on softs, from the same floored slope.

        The floor is a statement about lap time - "no tire at this circuit falls away
        more slowly than this" - and a statement about lap time does not get 40% weaker
        because the rubber is harder. `max` only ever raises, so a measured slope that
        already clears the floor on its own compound is untouched.
        """
        scaled = max(0.0, degradation) * COMPOUND_DEGRADATION_MULTIPLIER[compound]
        return max(scaled, floor)

    def lap_time(self, compound: str, age: int, lap: int, degradation: float) -> float:
        offset, _ = COMPOUND_MODEL[compound]
        falloff = self.effective_degradation(compound, degradation, self.degradation.floor)
        penalty = falloff * age
        if age > self.max_race_age:
            # Beyond anything observed in this race the linear model is the bug we are
            # fixing, so add a quadratic excess term. Smooth rather than a hard cliff:
            # placing a cliff needs the compound, and we don't have it.
            #
            # Scaled off the field's raw falloff, so the term survives a car whose own
            # slope is near zero - which is precisely the car that would otherwise be
            # handed a free unsurvivable stint. Deliberately *not* run through the
            # compound ratio: the comment above it has always said the cliff belongs to
            # the tire and the circuit, which the field shares, and scaling it per
            # compound contradicted that - it discounted the extrapolation 40% on hards,
            # the compound a stint this long would actually be run on.
            excess = age - self.max_race_age
            penalty += EXCESS_CURVATURE * max(0.0, self.field_degradation) * excess**2
        return self.pace_at_lap_zero - self.fuel_effect * lap + offset + penalty

    def stderr_for(self, max_age: int) -> float:
        """How much the slope is resampled by, widening outside the observed range."""
        if max_age <= self.max_driver_age:
            return self.degradation.stderr
        if max_age <= self.max_race_age:
            return self.degradation.stderr * UNOBSERVED_STDERR_INFLATION
        excess = max_age - self.max_race_age
        return self.degradation.stderr * (
            UNOBSERVED_STDERR_INFLATION + BEYOND_EVIDENCE_STDERR_GROWTH * excess
        )


def _max_stint_age(pit_laps: list[int], last_lap: int) -> int:
    return max((end - start for start, end in segment_stints(pit_laps, last_lap)), default=0)


def _build_pace_model(baseline: RaceBaseline, driver_id: str, final_lap: int) -> PaceModel:
    model = baseline.pace_model
    degradation = resolve_degradation(baseline, driver_id)
    fuel_effect = model.fuel_effect_per_lap if model is not None else DEFAULT_FUEL_EFFECT
    neutralized = set(model.neutralized_laps) if model is not None else set()
    actual_pit_laps = baseline.pit_laps.get(driver_id, [])

    # `base_pace_seconds` is the fitted lap time at tire age 0 on the stint's first lap,
    # so undoing the fuel term recovers the driver's single lap-zero intercept.
    intercepts: list[tuple[float, int]] = []
    if model is not None:
        for stint in model.stints:
            if stint.driver_id == driver_id and stint.fitted and stint.base_pace_seconds:
                intercepts.append(
                    (stint.base_pace_seconds + fuel_effect * stint.start_lap, stint.laps_used)
                )

    if intercepts:
        weight = sum(laps for _, laps in intercepts)
        pace_at_lap_zero = sum(value * laps for value, laps in intercepts) / weight
    else:
        pace_at_lap_zero = _fuel_corrected_base_pace(
            baseline.lap_times.get(driver_id, {}),
            set(actual_pit_laps),
            neutralized,
            fuel_effect,
            # Correct with the neutral compound's falloff: we don't know what they ran.
            max(0.0, degradation.per_lap),
            final_lap,
        )
        if pace_at_lap_zero is None:
            raise InvalidStrategyError(
                f"No usable green-flag laps for {driver_id} in {baseline.season} "
                f"round {baseline.round}, so there is no pace to model from."
            )

    max_race_age = (
        model.max_observed_stint_laps
        if model is not None and model.max_observed_stint_laps
        else max(
            (
                _max_stint_age(laps, min(baseline.total_laps, baseline.laps_completed.get(rid, 0)))
                for rid, laps in baseline.pit_laps.items()
            ),
            default=final_lap,
        )
    )
    max_driver_age = _max_stint_age(actual_pit_laps, final_lap)

    # No fitted field median (an unfitted race, or one where nothing passed the quality
    # gate) leaves the generic table's medium value, which is what tier 4 uses anyway.
    field_degradation = (
        model.field_median_degradation
        if model is not None and model.field_median_degradation is not None
        else COMPOUND_MODEL[STARTING_COMPOUND][1]
    )

    return PaceModel(
        pace_at_lap_zero=pace_at_lap_zero,
        fuel_effect=fuel_effect,
        degradation=degradation,
        # Never below what this car is credited with: a car dirtier on its tires than
        # the field should not fall off the cliff more gently than the field does.
        field_degradation=max(field_degradation, degradation.per_lap),
        max_driver_age=max_driver_age,
        max_race_age=max(max_race_age, max_driver_age),
    )


# ---------------------------------------------------------------------------
# Step 4 helpers - rival cumulative times
# ---------------------------------------------------------------------------


def _rival_cumulative_times(
    baseline: RaceBaseline, driver_id: str, final_lap: int
) -> dict[int, list[float]]:
    """Sorted rival cumulative race times per lap, for the position lookup.

    A rival is only in a lap's list if they have a `laps` row for it: retired and
    lapped-out rivals drop out from that point rather than counting as infinitely slow.
    """
    per_lap: dict[int, list[float]] = {lap: [] for lap in range(1, final_lap + 1)}
    for rival_id, times in baseline.lap_times.items():
        if rival_id == driver_id:
            continue
        cumulative = 0.0
        for lap in range(1, final_lap + 1):
            lap_time = times.get(lap)
            if lap_time is None:
                break  # their race ended here
            cumulative += lap_time
            per_lap[lap].append(cumulative)
    for laps in per_lap.values():
        laps.sort()
    return per_lap


# ---------------------------------------------------------------------------
# Steps 2, 3, 5 - one Monte Carlo run
# ---------------------------------------------------------------------------


def _sample_pit_loss(baseline: RaceBaseline, rng: random.Random) -> float:
    """Total pit-lane loss for one stop (entry, stop, exit) - not wheel-gun time.

    Prefers the durations actually recorded for this race, which bakes in the circuit's
    pit-lane length for free, and falls back to the flat 20-25s band.
    """
    clean = [d for d in baseline.pit_durations if 0 < d <= CLEAN_STOP_CEILING]
    if len(clean) >= MIN_CLEAN_STOPS:
        return rng.choice(clean)
    return rng.uniform(*PIT_PENALTY_RANGE)


def _sample_safety_car_lap(baseline: RaceBaseline, rng: random.Random) -> int | None:
    """Whether a safety car happens this run, and on which lap. Weighted toward mid-race."""
    probability = SAFETY_CAR_PROBABILITY.get(
        baseline.circuit_id, DEFAULT_SAFETY_CAR_PROBABILITY
    )
    if rng.random() >= probability or baseline.total_laps < 2:
        return None
    return int(rng.triangular(1, baseline.total_laps, baseline.total_laps / 2))


@dataclass
class _Run:
    total_time: float
    positions: list[int]  # index i -> position on lap i+1, from `first_changed_lap` on


def _simulate_once(
    *,
    strategy_laps: dict[int, str],
    pace: PaceModel,
    sampled_degradation: float,
    actual_lap_times: dict[int, float],
    rival_times: dict[int, list[float]],
    first_changed_lap: int,
    final_lap: int,
    baseline: RaceBaseline,
    rng: random.Random,
) -> _Run:
    """One end-to-end run of steps 1-5."""
    safety_car_lap = _sample_safety_car_lap(baseline, rng)

    # Step 2 + 5: price each stop, then discount the one taken at or before the safety
    # car. Only one stop is discounted per run - a single safety car is a single event.
    penalties = {lap: _sample_pit_loss(baseline, rng) for lap in strategy_laps}
    if safety_car_lap is not None:
        eligible = [lap for lap in strategy_laps if lap <= safety_car_lap]
        if eligible:
            lucky = max(eligible)
            discounted = penalties[lucky] - rng.uniform(*SAFETY_CAR_DISCOUNT_RANGE)
            penalties[lucky] = max(MIN_EFFECTIVE_PIT_LOSS, discounted)

    ages = _tire_age_by_lap(final_lap, set(strategy_laps))
    cumulative = 0.0
    positions: list[int] = []
    compound = STARTING_COMPOUND

    for lap in range(1, final_lap + 1):
        if lap < first_changed_lap:
            # Step 3: identical to baseline, so don't re-model it. A stop on such a
            # lap is still a stop, so its penalty is charged here - otherwise any
            # hypothetical stop before the first changed lap would be free.
            cumulative += actual_lap_times.get(
                lap, pace.lap_time(compound, ages[lap], lap, sampled_degradation)
            )
            if lap in strategy_laps:
                cumulative += penalties[lap]
        else:
            cumulative += pace.lap_time(compound, ages[lap], lap, sampled_degradation)
            if lap in strategy_laps:
                cumulative += penalties[lap]
            # Step 4: lower cumulative time = ahead on track.
            positions.append(1 + bisect_left(rival_times[lap], cumulative))

        if lap in strategy_laps:
            compound = strategy_laps[lap]

    return _Run(total_time=cumulative, positions=positions)


# ---------------------------------------------------------------------------
# Step 6 - Monte Carlo
# ---------------------------------------------------------------------------


def run_simulation(
    request: SimulationRequest, baseline: RaceBaseline, seed: int | None = None
) -> SimulationResponse:
    """Run `request.num_simulations` iterations and aggregate them.

    Raises `InvalidStrategyError` for anything the caller should see as a 400. The
    caller is responsible for the 404s (race not cached, driver not in the race).
    """
    driver_id = request.driver_id
    validate_strategy(request.strategy, baseline.total_laps)

    # Refuse before doing any work. A wet or drying race produces garbage degradation
    # slopes, and returning a confident number from the generic table would be worse
    # than saying we can't model it.
    if baseline.pace_model is not None and baseline.pace_model.conditions == CONDITIONS_MIXED:
        raise UnsupportedConditionsError(
            f"Season {baseline.season} round {baseline.round} ran in wet or changing "
            "conditions, which the tire model does not support."
        )

    actual_lap_times = baseline.lap_times.get(driver_id, {})
    if not actual_lap_times:
        raise InvalidStrategyError(
            f"No lap-by-lap data cached for {driver_id} in {baseline.season} "
            f"round {baseline.round}, so there is nothing to simulate against."
        )

    # A driver who retired only ran part of the race; simulating past that would be
    # inventing laps. Their delta is null (simulation-logic.md Step 6).
    completed = baseline.laps_completed.get(driver_id, 0)
    final_lap = min(baseline.total_laps, completed) if completed else baseline.total_laps
    final_lap = min(final_lap, max(actual_lap_times))

    strategy_laps = {stop.lap: stop.compound_in for stop in request.strategy}
    actual_pit_laps = set(baseline.pit_laps.get(driver_id, []))

    # Step 3: the first lap whose outcome can differ. Comparing pit *laps* alone is
    # not enough: the user can keep the real pit laps and change only the compounds,
    # which leaves the symmetric difference empty while every stint after the first
    # stop still runs on a different tire. Since real stint compounds are unknown
    # (see the compound asymmetry note in simulation-logic.md), any hypothetical stop
    # re-models the stint that follows it, so the earliest hypothetical stop is always
    # a change even when its lap matches reality.
    changed = set(strategy_laps) ^ actual_pit_laps
    candidates = changed | ({min(strategy_laps)} if strategy_laps else set())
    first_changed_lap = min(candidates) if candidates else final_lap + 1

    pace = _build_pace_model(baseline, driver_id, final_lap)
    rival_times = _rival_cumulative_times(baseline, driver_id, final_lap)

    # Step G/H: how far outside the evidence this strategy asks us to go. One number for
    # the whole strategy, taken from its longest stint, because the resampled slope is
    # a property of the run rather than of a lap.
    hypothetical_max_age = _max_stint_age(sorted(strategy_laps), final_lap)
    stderr = pace.stderr_for(hypothetical_max_age)
    beyond_evidence = hypothetical_max_age > pace.max_race_age

    rng = random.Random(seed)
    runs = [
        _simulate_once(
            strategy_laps=strategy_laps,
            pace=pace,
            # Third variance source, alongside the safety car and the pit-loss sample:
            # 500 runs of a confident-but-wrong slope would otherwise cluster tightly
            # around a wrong number. Held at the same floor the point estimate is, so
            # the runs in the low tail can't undo it.
            sampled_degradation=max(
                pace.degradation.floor, rng.gauss(pace.degradation.per_lap, stderr)
            ),
            actual_lap_times=actual_lap_times,
            rival_times=rival_times,
            first_changed_lap=first_changed_lap,
            final_lap=final_lap,
            baseline=baseline,
            rng=rng,
        )
        for _ in range(request.num_simulations)
    ]

    times = [run.total_time for run in runs]
    distribution: dict[int, int] = {}
    for run in runs:
        finish = run.positions[-1] if run.positions else _actual_position(baseline, driver_id, final_lap)
        distribution[finish] = distribution.get(finish, 0) + 1

    millis = baseline.finish_time_ms.get(driver_id)
    baseline_time = None if millis is None else millis / 1000.0
    mean_time = fmean(times)

    return SimulationResponse(
        season=baseline.season,
        round=baseline.round,
        driver_id=driver_id,
        baseline_time_seconds=baseline_time,
        simulated=SimulationSummary(
            mean_time_seconds=round(mean_time, 3),
            median_time_seconds=round(median(times), 3),
            delta_vs_actual_seconds=(
                None if baseline_time is None else round(mean_time - baseline_time, 3)
            ),
            # Sorted so the JSON object reads front-to-back.
            finish_position_distribution=dict(sorted(distribution.items())),
        ),
        lap_by_lap=_lap_by_lap(
            baseline, driver_id, _median_run(runs), first_changed_lap, final_lap
        ),
        pace_model=PaceModelInfo(
            tier=pace.degradation.tier,
            tier_source=pace.degradation.source,
            source_driver_id=pace.degradation.source_driver_id,
            degradation_per_lap=round(pace.degradation.per_lap, 5),
            degradation_floored=pace.degradation.floored,
            degradation_stderr=round(stderr, 5),
            fuel_effect_per_lap=round(pace.fuel_effect, 5),
            beyond_evidence=beyond_evidence,
            hypothetical_max_tire_age=hypothetical_max_age,
            max_observed_stint_laps=pace.max_race_age,
        ),
    )


def _median_run(runs: list[_Run]) -> _Run:
    """The representative run for the chart - the one with the median total time."""
    return sorted(runs, key=lambda run: run.total_time)[len(runs) // 2]


def _actual_position(baseline: RaceBaseline, driver_id: str, lap: int) -> int:
    positions = baseline.lap_positions.get(driver_id, {})
    return positions.get(lap, 0)


def _lap_by_lap(
    baseline: RaceBaseline,
    driver_id: str,
    run: _Run,
    first_changed_lap: int,
    final_lap: int,
) -> list[LapComparison]:
    """Track position per lap for both strategies (median run only).

    Laps before the first change are identical by construction, so the hypothetical
    line reuses the recorded position there. Deriving them from cumulative time instead
    would show phantom position swaps on laps where nothing actually changed, because
    the cumulative-time reading and the official classification treat lapped cars
    differently.
    """
    comparisons: list[LapComparison] = []
    for lap in range(1, final_lap + 1):
        actual = _actual_position(baseline, driver_id, lap)
        if lap < first_changed_lap:
            hypothetical = actual
        else:
            index = lap - first_changed_lap
            hypothetical = run.positions[index] if index < len(run.positions) else actual
        comparisons.append(
            LapComparison(lap=lap, hypothetical_position=hypothetical, actual_position=actual)
        )
    return comparisons
