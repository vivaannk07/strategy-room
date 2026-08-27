"""Monte Carlo pit-strategy simulation.

Implements simulation-logic.md steps 1-6 against a `RaceBaseline` loaded from the
Postgres cache. The asymmetry that shapes the whole module: **compound is known only
for the hypothetical strategy**, because the user picked it. The baseline side has no
compound model at all - it is the driver's recorded `lap_time_seconds` values, used
as-is. So this compares a modeled strategy against recorded reality, not two models.

Nothing here touches the database or the network; it takes a baseline in and returns
a `SimulationResponse`.
"""

from __future__ import annotations

import random
from bisect import bisect_left
from dataclasses import dataclass
from statistics import fmean, median

from app.repository import RaceBaseline
from app.schemas import (
    COMPOUNDS,
    LapComparison,
    SimulationRequest,
    SimulationResponse,
    SimulationSummary,
    StrategyStop,
)

__all__ = ["InvalidStrategyError", "run_simulation"]


class InvalidStrategyError(ValueError):
    """The request can't be simulated. Surfaces as a 400."""


# --- Step 1: tire degradation model ---------------------------------------
# (lap-time offset vs. the driver's own median pace, degradation seconds per lap).
# Starting deltas from simulation-logic.md; intermediate/wet are extrapolations so the
# full COMPOUNDS tuple is covered. All of this is meant to be tuned against real data.
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


def _green_flag_pace(lap_times: dict[int, float], pit_laps: set[int]) -> float:
    """The driver's own median green-flag lap time - the model's reference pace.

    `base_lap_time_for_compound` is a model parameter, not upstream data, so it is
    derived from the pace the driver actually showed. Lap 1 (standing start), pit laps
    and anything well off the median are excluded as unrepresentative.
    """
    candidates = [t for lap, t in lap_times.items() if lap != 1 and lap not in pit_laps]
    if not candidates:
        candidates = list(lap_times.values())
    raw = median(candidates)
    clean = [t for t in candidates if t <= raw * GREEN_FLAG_TOLERANCE]
    return median(clean) if clean else raw


@dataclass(frozen=True)
class PaceModel:
    """Per-compound lap time as a function of tire age.

    Centred on the tire age the driver actually ran: the median pace already has real
    degradation baked into it, so adding a raw `deg * age` on top would make every
    hypothetical strategy slower than reality for free. Centring means a hypothetical
    strategy that keeps the tires as fresh as the real one reproduces the real pace,
    and only the *difference* in tire age moves the number.
    """

    reference_pace: float
    reference_age: float

    def lap_time(self, compound: str, age: int) -> float:
        offset, degradation = COMPOUND_MODEL[compound]
        return self.reference_pace + offset + degradation * (age - self.reference_age)


def _build_pace_model(baseline: RaceBaseline, driver_id: str, final_lap: int) -> PaceModel:
    lap_times = baseline.lap_times.get(driver_id, {})
    actual_pit_laps = set(baseline.pit_laps.get(driver_id, []))
    pace = _green_flag_pace(lap_times, actual_pit_laps)
    actual_ages = _tire_age_by_lap(final_lap, actual_pit_laps)
    reference_age = fmean(actual_ages.values()) if actual_ages else 0.0
    return PaceModel(reference_pace=pace, reference_age=reference_age)


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
            cumulative += actual_lap_times.get(lap, pace.reference_pace)
            if lap in strategy_laps:
                cumulative += penalties[lap]
        else:
            cumulative += pace.lap_time(compound, ages[lap])
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

    rng = random.Random(seed)
    runs = [
        _simulate_once(
            strategy_laps=strategy_laps,
            pace=pace,
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
