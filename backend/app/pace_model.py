"""Step 0 of simulation-logic.md - derive a race's pace model from recorded lap times.

Replaces the fixed per-compound degradation table as the *magnitude* of tire falloff.
For each driver in a race we measure how fast their lap time actually fell away per lap
of tire age, by fitting their recorded laps to

    lap_time = base_pace - fuel_effect * lap + degradation * tire_age

where `tire_age` resets at every pit stop and `lap` never does. See
`degradation-model.md` for the full derivation.

Two things about the fit are load-bearing:

**All of a driver's stints are fitted jointly, pooled with every other driver in the
race.** Within one stint tire age and lap number differ by a constant, so a per-stint
regression measures `degradation - fuel_effect` and understates degradation by roughly
0.05 s/lap. The pit stop is what separates them: age drops to zero while the lap number
carries on.

**The intercept is per driver, not per stint.** The design doc proposes a free intercept
*and* a free slope per stint alongside one shared fuel coefficient; that design matrix is
exactly rank deficient, because within a stint `lap = tire_age + start_lap`, so any fuel
coefficient can be absorbed by shifting the stint's own intercept and slope. Sharing one
intercept across a driver's stints is what identifies fuel: it says the car's fresh-tire
pace is the same all race except for the fuel it has burned, so the drop in fresh-tire
pace from one stint to the next measures fuel burn directly.

Nothing here touches the database or the network - it takes lap/pit dicts in and returns
a `RacePaceModel`. Persistence lives in `app.repository`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from statistics import median

__all__ = [
    "MODEL_VERSION",
    "CONDITIONS_DRY",
    "CONDITIONS_MIXED",
    "QUALITY_GOOD",
    "QUALITY_SPARSE",
    "QUALITY_UNRELIABLE",
    "RacePaceModel",
    "StintFit",
    "compute_pace_model",
    "segment_stints",
]

# Bump to invalidate every cached fit. `repository.ensure_pace_model` recomputes any
# row whose stored version is older than this.
#   2: long safety cars no longer read as weather, and weather is judged against the
#      circuit's own dry pace rather than the race's own median.
#   3: rain and safety cars are told apart by how far the *field* spreads out, not by
#      how long the block lasts, and a block against either end of the race is decided
#      against the race's own green baseline instead of being given up on.
#   4: adjacent blocks are merged before the length check can wave their halves through
#      separately, and a block the whole field pits inside is a conditions change - the
#      one signal still readable on the laps where the spread test goes blind.
MODEL_VERSION = 4

# --- Step C: pooled fuel coefficient ---------------------------------------
# ~0.03 s/kg x ~1.8 kg/lap. The band covers a short lap (Monaco) to a long one (Spa);
# a fit outside it is telling us something is wrong with the race, not about fuel.
FUEL_EFFECT_BOUNDS = (0.02, 0.12)
DEFAULT_FUEL_EFFECT = 0.055

# --- Step B: filtering -----------------------------------------------------
# A lap whose field median exceeds this multiple of the local baseline is neutralized.
NEUTRALIZATION_RATIO = 1.15
# Half-width of the rolling window the baseline is taken over.
NEUTRALIZATION_WINDOW = 5
# A block of slow laps no longer than this is a neutralization on length alone, with no
# further questions asked. Deliberately back at 8 rather than the 15 it was briefly
# raised to: 15 bought back the long-safety-car races by making length carry a load it
# cannot bear, and a genuine 9-15 lap rain spell was being filtered away as a
# neutralization and the race then served as confidently dry. A race wrongly refused is
# recoverable; a wet race answered as if it were dry is not.
#
# The long-safety-car races come back a different way - see `_spread_says_neutralization`
# below - so nothing is given up by keeping this number small. Length is only ever a
# *sufficient* condition here, never the thing that separates rain from a safety car.
MAX_NEUTRALIZATION_RUN = 8
# A block too long to settle on length also has to show the field's pace coming back.
RESTART_PACE_TOLERANCE = 0.08
RESTART_WINDOW = 5
# What actually tells rain and a neutralization apart, at any length. Under a safety car
# the field is queued at a mandated delta, so the *spread* of lap times across the field
# stays about what it is under green - every car is limited by the one ahead, not by the
# track. Rain does the opposite: grip, tire choice and wet-weather confidence differ per
# driver, and the field comes apart.
#
# Measured on the cached races, as a multiple of each race's own green spread:
#     Silverstone 2023, laps 33-38 (safety car)   1.06x
#     Zandvoort 2023,   laps 2-11  (wet start)    3.2x
#     Zandvoort 2023,   laps 17-21 (wet)          3.7x
#     Zandvoort 2023,   laps 60-67 (wet finish)   2.5x
# 1.6 is roughly the geometric middle of that gap: half again the worst safety car
# observed, and well under the mildest wet running observed.
NEUTRALIZATION_DISPERSION_RATIO = 1.6
# The spread is an interquartile range, so it needs enough cars on a lap to have
# quartiles, and enough laps in a block for its median to mean anything.
#
# `DISPERSION_MIN_LAPS` stays at 3 deliberately. Individual laps inside a *genuine*
# safety car read wildly - Silverstone 2023's block runs 0.82x, 1.07x, 22.01x, 0.48x,
# 0.93x, 6.61x, and only its median (1.00x) identifies it - so a one- or two-lap block
# judged on spread is judged on noise. Lowering this to 2 turns Melbourne 2024 laps
# 57-58 (Russell's crash, the race finishing under the VSC, and no pit stop by anyone)
# into "rain" on the strength of two deployment laps reading 22.08x and 8.14x.
DISPERSION_MIN_CARS = 6
DISPERSION_MIN_LAPS = 3
# Flagged blocks separated by no more than this many un-flagged laps are one event.
# A single lap can drop back under the threshold in the middle of a genuine block -
# Zandvoort 2023 lap 62, between the two halves of the wet finish - and splitting there
# hands each half to the length check separately, which waves both through as short
# neutralizations. Merging first is what makes the length check see the real block.
NEUTRALIZATION_MERGE_GAP = 1
# The share of the running field pitting on one lap that means the tires everyone is on
# have stopped being the right tires - a wet/dry crossover or a red-flag restart onto a
# changed track, either way a conditions change rather than a neutralization.
#
# This is the signal that answers the blocks the spread test cannot see at all. Spread
# is measured off cars that are *not* on an in- or out-lap, so the moment the whole
# field dives into the pit lane there is nothing left to measure: Zandvoort 2023 laps
# 61 and 63-65 leave 2, 4, 0 and 0 cars standing, which is `DISPERSION_MIN_CARS`, not
# `DISPERSION_MIN_LAPS`, refusing to answer. No threshold on lap counts can recover a
# lap with no measurement in it; the pit lane itself has to carry the signal.
#
# Measured across the cached races, as the peak single-lap share within each block:
#     Silverstone 2023, laps 33-38 (safety car)    0.28
#     Zandvoort 2023,   laps 16-21 (wet)           0.21
#     Zandvoort 2023,   laps  1-3  (wet start)     0.35
#     Melbourne 2024,   laps 57-58 (VSC to flag)   0.00
#     Zandvoort 2023,   laps 63-66 (wet finish)    1.00  (17 of 17 cars, lap 64)
# A safety car produces a pit *wave* - a burst on the lap the cars can reach the pit
# entry - but never the whole field, because half of it stays out on strategy. 0.5 sits
# in the gap between the widest wave observed and the field-wide change.
TIRE_REGIME_PIT_SHARE = 0.5
# Weather: a sustained block this far off the race median, this many laps long, that
# is not a neutralization, is a wet/dry regime shift.
WEATHER_RATIO = 0.10
WEATHER_MIN_RUN = 5
# The race's green-flag pace as one number, for comparison against other races at the
# same circuit: a low quantile, i.e. the race at its quickest, since that is what a dry
# reference has to be.
GREEN_PACE_QUANTILE = 0.25
# A race whose *quickest* green pace is this far off the circuit's historical dry pace
# was not run in the dry. Wet pace is 15-40% off; the gap between two dry races at the
# same circuit in different seasons is a couple of percent, so the band is wide enough
# to absorb regulation changes and a resurface without swallowing rain.
WET_PACE_RATIO = 0.10
# Traffic only ever makes a lap slower, so the outlier trim is one-sided.
TRAFFIC_RESIDUAL_CEILING = 1.0

# --- Step D: quality gate --------------------------------------------------
GOOD_MIN_LAPS = 8
SPARSE_MIN_LAPS = 5
# A car genuinely getting faster on older tires means the fit caught a drying track or
# misattributed fuel, not tire behaviour.
MIN_PLAUSIBLE_DEGRADATION = -0.02

CONDITIONS_DRY = "dry"
CONDITIONS_MIXED = "mixed"

QUALITY_GOOD = "good"
QUALITY_SPARSE = "sparse"
QUALITY_UNRELIABLE = "unreliable"


@dataclass(frozen=True)
class StintFit:
    """One driver, one stint. Mirrors a `driver_stint_fits` row."""

    driver_id: str
    stint_number: int
    start_lap: int
    end_lap: int
    laps_used: int
    base_pace_seconds: float | None
    degradation_per_lap: float | None
    degradation_stderr: float | None
    r_squared: float | None
    max_tire_age: int
    quality: str

    @property
    def fitted(self) -> bool:
        return self.degradation_per_lap is not None and self.quality != QUALITY_UNRELIABLE


@dataclass(frozen=True)
class RacePaceModel:
    """One race's derived pace model. Mirrors a `race_pace_models` row plus its stints."""

    season: int
    round: int
    fuel_effect_per_lap: float
    fuel_effect_source: str  # fitted | clamped | default
    field_median_degradation: float | None
    max_observed_stint_laps: int
    neutralized_laps: list[int]
    conditions: str
    # This race's own green-flag pace. Recorded even for a race we refuse, because it is
    # what *other* races at this circuit are measured against - see `_detect_conditions`.
    green_reference_pace: float | None = None
    model_version: int = MODEL_VERSION
    stints: list[StintFit] = field(default_factory=list)

    @property
    def is_simulatable(self) -> bool:
        """A `mixed` race is refused rather than modeled - see api-contract.md."""
        return self.conditions != CONDITIONS_MIXED


# ---------------------------------------------------------------------------
# Step A - stint segmentation
# ---------------------------------------------------------------------------


def segment_stints(pit_laps: list[int], last_lap: int) -> list[tuple[int, int]]:
    """(start_lap, end_lap) per stint, 1-indexed and inclusive.

    A stop on lap L happens *during* L, so L is the last lap on the old set and L+1 is
    the first on the new one - the same convention as `simulation._tire_age_by_lap`.
    """
    stints: list[tuple[int, int]] = []
    start = 1
    for lap in sorted({lap for lap in pit_laps if 1 <= lap < last_lap}):
        stints.append((start, lap))
        start = lap + 1
    if start <= last_lap:
        stints.append((start, last_lap))
    return stints


# ---------------------------------------------------------------------------
# Step B - green-flag filtering
# ---------------------------------------------------------------------------


def _field_median_by_lap(
    lap_times: dict[str, dict[int, float]], last_lap: int
) -> dict[int, float]:
    """Median lap time across every driver still running, per lap.

    A neutralization is a field-wide event, so it shows up here even though Jolpica
    publishes no track-status data. Per-driver detection cannot tell a safety car from
    one driver having a bad lap.
    """
    per_lap: dict[int, list[float]] = {}
    for times in lap_times.values():
        for lap, seconds in times.items():
            if 1 <= lap <= last_lap:
                per_lap.setdefault(lap, []).append(seconds)
    return {lap: median(values) for lap, values in per_lap.items() if values}


def _consecutive_runs(laps: set[int]) -> list[list[int]]:
    """Split a lap set into runs of consecutive lap numbers."""
    runs: list[list[int]] = []
    for lap in sorted(laps):
        if runs and lap == runs[-1][-1] + 1:
            runs[-1].append(lap)
        else:
            runs.append([lap])
    return runs


def _field_dispersion_by_lap(
    lap_times: dict[str, dict[int, float]],
    pit_laps: dict[str, list[int]],
    last_lap: int,
) -> dict[int, float]:
    """Interquartile spread of the field's lap times, per lap, as a fraction of the median.

    This is the shape signal the field median cannot give: *how far apart* the cars are,
    rather than how fast they are. In- and out-laps are dropped first, because a lap on
    which half the field is in the pit lane is spread out for a reason that has nothing
    to do with the track - which is exactly the lap a safety car produces.

    A lap with too few cars left to have quartiles is simply absent from the result;
    callers treat a missing lap as "no opinion" rather than as zero spread.
    """
    per_lap: dict[int, list[float]] = {}
    for driver_id, times in lap_times.items():
        stops = set(pit_laps.get(driver_id, []))
        for lap, seconds in times.items():
            if 1 <= lap <= last_lap and lap not in stops and lap - 1 not in stops:
                per_lap.setdefault(lap, []).append(seconds)

    dispersion: dict[int, float] = {}
    for lap, values in per_lap.items():
        if len(values) < DISPERSION_MIN_CARS:
            continue
        values.sort()
        middle = median(values)
        if middle <= 0:
            continue
        dispersion[lap] = (values[(3 * len(values)) // 4] - values[len(values) // 4]) / middle
    return dispersion


def _green_dispersion(dispersion: dict[int, float], flagged: set[int]) -> float | None:
    """How far apart the field runs when nothing is going on. The comparison point."""
    values = [
        spread for lap, spread in dispersion.items() if lap != 1 and lap not in flagged
    ]
    return median(values) if len(values) >= DISPERSION_MIN_LAPS else None


def _pit_wave_by_lap(
    lap_times: dict[str, dict[int, float]],
    pit_laps: dict[str, list[int]],
    last_lap: int,
) -> dict[int, float]:
    """Share of the cars still running that pit on each lap.

    The denominator is cars still circulating, not the starting grid, so a stop late in
    a race that has already lost half its field is not diluted by the cars in the garage.
    """
    running: dict[int, int] = {}
    for times in lap_times.values():
        for lap in times:
            if 1 <= lap <= last_lap:
                running[lap] = running.get(lap, 0) + 1

    stops: dict[int, int] = {}
    for laps in pit_laps.values():
        for lap in laps:
            if 1 <= lap <= last_lap:
                stops[lap] = stops.get(lap, 0) + 1

    return {
        lap: stops.get(lap, 0) / count for lap, count in running.items() if count > 0
    }


def _pit_wave_says_regime_change(pit_wave: dict[int, float], run: list[int]) -> bool:
    """Did the field change what it was running on, mid-block?

    One lap is enough. A field-wide stop is not a thing that happens twice for the same
    reason, and requiring two of them would miss a crossover that caught everyone on the
    same lap.
    """
    return any(pit_wave.get(lap, 0.0) >= TIRE_REGIME_PIT_SHARE for lap in run)


def _merge_runs(runs: list[list[int]], gap: int) -> list[list[int]]:
    """Join runs separated by at most `gap` laps, filling the laps in between.

    The gap laps are absorbed into the block. A lap that dipped back under the flagging
    threshold in the middle of an event belongs to the event, and whatever the merged
    block is decided to be, that lap is it too.
    """
    if not runs:
        return []
    merged = [list(runs[0])]
    for run in runs[1:]:
        if run[0] - merged[-1][-1] - 1 <= gap:
            merged[-1] = list(range(merged[-1][0], run[-1] + 1))
        else:
            merged.append(list(run))
    return merged


def _spread_says_neutralization(
    dispersion: dict[int, float], green_dispersion: float | None, run: list[int]
) -> bool | None:
    """Does the field stay as bunched through this block as it is under green?

    `True` is safety-car shaped, `False` is rain shaped, `None` means there were not
    enough clean cars on enough laps to have an opinion.

    The median across the block rather than its worst lap: the lap a safety car is
    deployed on and the lap it comes back in on are genuinely ragged - cars are caught
    at different points on the circuit - and neither of those laps is what the block is.
    """
    if green_dispersion is None or green_dispersion <= 0:
        return None
    values = [dispersion[lap] for lap in run if lap in dispersion]
    if len(values) < DISPERSION_MIN_LAPS:
        return None
    return median(values) <= green_dispersion * NEUTRALIZATION_DISPERSION_RATIO


def _detect_neutralized_laps(
    field_median: dict[int, float],
    dispersion: dict[int, float] | None = None,
    pit_wave: dict[int, float] | None = None,
) -> set[int]:
    """Lap numbers run behind a safety car or VSC, plus the restart lap after each.

    Two passes: a global median flags the obvious blocks, then the baseline is
    recomputed as a rolling median over the laps that survived, so a long neutralization
    cannot drag its own baseline up and hide inside it.

    Adjacent blocks are merged (`_merge_runs`) before any of this. A block that dips
    back under the flagging threshold for a lap in the middle would otherwise arrive
    here as two short blocks, each of which clears `MAX_NEUTRALIZATION_RUN` on its own
    even though the event they belong to does not.

    Each merged block is then judged on three questions, in order:

    **Did the field change tires en masse?** (`_pit_wave_says_regime_change`) The whole
    field pitting inside the block means the tires it started the block on are no longer
    the right ones, which is a conditions change by definition. This is asked first
    because it is the only question that can still be answered when the field is in the
    pit lane - which is exactly when the spread test goes blind, since a car on an
    in- or out-lap is excluded from the spread it would otherwise contribute to.

    **Did the field bunch up or come apart?** (`_spread_says_neutralization`) A safety
    car queues the cars at a mandated delta, so they stay as close together as they are
    under green; rain scatters them. This runs on every block whatever its length, and
    is the only thing standing between a 9-15 lap rain spell and a race served as dry.

    **Did the racing resume?** (`_returns_to_baseline`) Only asked of a block too long to
    be a neutralization on length alone, and only after the spread test has *positively*
    identified it - a block past `MAX_NEUTRALIZATION_RUN` whose spread cannot be measured
    is left for the weather check rather than waved through.

    Anything that fails is left in place for `_detect_conditions` to read as weather.
    `dispersion` and `pit_wave` are optional so a caller with nothing but field medians
    still gets the old length-and-restart behaviour; `compute_pace_model` passes both.
    """
    laps = sorted(field_median)
    if len(laps) < 3:
        return set()

    race_median = median(field_median[lap] for lap in laps)
    coarse = {lap for lap in laps if field_median[lap] > race_median * NEUTRALIZATION_RATIO}

    flagged: set[int] = set()
    for lap in laps:
        window = [
            field_median[other]
            for other in range(lap - NEUTRALIZATION_WINDOW, lap + NEUTRALIZATION_WINDOW + 1)
            if other in field_median and other not in coarse
        ]
        baseline = median(window) if window else race_median
        if field_median[lap] > baseline * NEUTRALIZATION_RATIO:
            flagged.add(lap)

    dispersion = dispersion or {}
    pit_wave = pit_wave or {}
    runs = _merge_runs(_consecutive_runs(flagged), NEUTRALIZATION_MERGE_GAP)
    # The green baseline is every lap no block covers, merged gap laps included: a lap
    # sitting inside an event is not a sample of what the race looks like without one.
    covered = {lap for run in runs for lap in run}
    green_dispersion = _green_dispersion(dispersion, covered)

    neutralized: set[int] = set()
    for run in runs:
        if _pit_wave_says_regime_change(pit_wave, run):
            # The field swapped compounds mid-block. Nothing about a safety car makes
            # every car need different rubber, so this is the track changing under them.
            continue
        spread = _spread_says_neutralization(dispersion, green_dispersion, run)
        if spread is False:
            # The field came apart rather than together. Whatever slowed these laps was
            # the track, not a queue behind a safety car - hand it to the weather check.
            continue
        if len(run) <= MAX_NEUTRALIZATION_RUN:
            neutralized.update(run)
        elif spread is True and _returns_to_baseline(field_median, flagged, run):
            # Past the length that settles it on its own, being *unable* to measure the
            # spread is not permission to filter the block away: `spread is None` falls
            # through here to the weather check on purpose. A refused race is recoverable;
            # a wet race silently served as dry is not.
            neutralized.update(run)
    # The restart lap is no more representative of tire pace than the SC lap itself.
    neutralized.update({lap + 1 for lap in list(neutralized) if lap + 1 in field_median})
    return neutralized


def _returns_to_baseline(
    field_median: dict[int, float], flagged: set[int], run: list[int]
) -> bool:
    """Is the field back at its pre-block pace once this block of slow laps ends?

    This is what `MAX_NEUTRALIZATION_RUN` was using length as a proxy for. A safety car
    ends and the cars go back to the pace they had; rain moves the baseline, so the laps
    after a wet block stay slow. Comparing the two sides separates the two cases without
    having to assert how long a safety car is allowed to last.

    A block against either end of the race has only one side. Returning False there was
    a bug, not caution: a safety car deployed on lap 1, or one still out at the flag, has
    no "before" or no "after" to offer and was handed to the weather check every time,
    which duly called a dry race rain. So the one side it does have is compared against
    the race's **own green baseline** - the median of every lap no block was flagged on -
    which answers the same question the two-sided test asks: is the racing either side of
    this block the pace this race runs at generally?

    That one-sided comparison is the weaker of the two, because the green baseline
    overlaps the side window it is being compared against. It is only ever reached for a
    block `_spread_says_neutralization` has already recognised as safety-car shaped, and
    that is what carries the discrimination here.
    """
    start, end = run[0], run[-1]
    before = _clean_window(field_median, flagged, range(start - 1, start - 1 - RESTART_WINDOW, -1))
    after = _clean_window(field_median, flagged, range(end + 1, end + 1 + RESTART_WINDOW))
    sides = [median(window) for window in (before, after) if window]
    if not sides:
        return False  # the block is the whole race; nothing to compare it against
    if len(sides) == 1:
        green = _clean_window(
            field_median, flagged, (lap for lap in sorted(field_median) if lap != 1)
        )
        if len(green) < RESTART_WINDOW:
            return False
        sides.append(median(green))
    low, high = sorted(sides)
    return low > 0 and high / low <= 1 + RESTART_PACE_TOLERANCE


def _clean_window(
    field_median: dict[int, float], flagged: set[int], laps
) -> list[float]:
    """Field medians for the given laps, skipping ones already flagged as slow."""
    return [field_median[lap] for lap in laps if lap in field_median and lap not in flagged]


def _green_reference_pace(
    field_median: dict[int, float], neutralized: set[int]
) -> float | None:
    """The race's green-flag pace as a single number, comparable across races.

    A low quantile rather than a median: it is the race at its quickest, which is the
    only part of a mixed race that can be dry, and it shrugs off the slow laps a median
    absorbs (traffic after a restart, a lap nobody flagged). Fuel burn is inside the
    number, but it is inside every race's number equally, so the comparison survives it.
    """
    values = sorted(
        field_median[lap] for lap in field_median if lap != 1 and lap not in neutralized
    )
    if len(values) < WEATHER_MIN_RUN:
        return None
    index = min(len(values) - 1, int(len(values) * GREEN_PACE_QUANTILE))
    return round(values[index], 4)


def _detect_conditions(
    field_median: dict[int, float],
    neutralized: set[int],
    circuit_reference_pace: float | None,
) -> str:
    """`dry` or `mixed`. Detect weather at race level; never try to model it.

    A wet-to-dry race would otherwise produce spectacular garbage slopes, so the honest
    v1 answer is to recognize the case and refuse to fit it.

    Two checks, because they catch different races. The **absolute** one compares this
    race's green pace against the same circuit's dry pace in other cached races: a race
    that is wet from lights to flag has no dry stretch to stand out against, so it looks
    perfectly normal next to its own median and is only visible from outside. The
    **relative** one is the original within-race regime shift, which is what catches a
    race that changes conditions partway - and, on a circuit we have never seen dry, is
    all we have.

    Neither check can be tripped by a safety car: both read only the laps that survived
    `_detect_neutralized_laps`, and the absolute one takes a low quantile of them, so a
    slow block would have to be most of the race to move it.
    """
    candidates = [lap for lap in sorted(field_median) if lap != 1 and lap not in neutralized]
    if len(candidates) < WEATHER_MIN_RUN:
        return CONDITIONS_DRY

    green = _green_reference_pace(field_median, neutralized)
    if (
        circuit_reference_pace is not None
        and green is not None
        and green > circuit_reference_pace * (1 + WET_PACE_RATIO)
    ):
        return CONDITIONS_MIXED

    race_median = median(field_median[lap] for lap in candidates)
    off = {
        lap
        for lap in candidates
        if abs(field_median[lap] - race_median) > race_median * WEATHER_RATIO
    }
    longest = max((len(run) for run in _consecutive_runs(off)), default=0)
    return CONDITIONS_MIXED if longest >= WEATHER_MIN_RUN else CONDITIONS_DRY


# ---------------------------------------------------------------------------
# Steps C and D - the pooled least-squares fit
#
# The design matrix is sparse in a fixed pattern: every row touches exactly one fuel
# column, one driver intercept and one stint slope. So the normal equations are
# accumulated directly (nine updates per row) rather than materialising X, and solved
# by Cholesky - which also tells us when the system is degenerate.
# ---------------------------------------------------------------------------


@dataclass
class _Row:
    """One usable lap, as (column index, value) pairs plus the observed lap time."""

    indices: tuple[int, ...]
    values: tuple[float, ...]
    y: float
    stint_key: tuple[str, int]


def _normal_equations(rows: list[_Row], n: int) -> tuple[list[list[float]], list[float]]:
    matrix = [[0.0] * n for _ in range(n)]
    rhs = [0.0] * n
    for row in rows:
        for i, index in enumerate(row.indices):
            value = row.values[i]
            rhs[index] += value * row.y
            target = matrix[index]
            for j, other in enumerate(row.indices):
                target[other] += value * row.values[j]
    return matrix, rhs


def _cholesky(matrix: list[list[float]]) -> list[list[float]] | None:
    """Lower-triangular L with L @ L.T == matrix, or None if it is not positive definite.

    Non-positive-definite means the fit is degenerate (a rank-deficient design matrix),
    which is exactly the case the callers want to fall back on.
    """
    n = len(matrix)
    lower = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1):
            total = matrix[i][j] - sum(lower[i][k] * lower[j][k] for k in range(j))
            if i == j:
                if total <= 1e-10:
                    return None
                lower[i][i] = total**0.5
            else:
                lower[i][j] = total / lower[j][j]
    return lower


def _chol_solve(lower: list[list[float]], rhs: list[float]) -> list[float]:
    n = len(lower)
    forward = [0.0] * n
    for i in range(n):
        forward[i] = (rhs[i] - sum(lower[i][k] * forward[k] for k in range(i))) / lower[i][i]
    solution = [0.0] * n
    for i in range(n - 1, -1, -1):
        solution[i] = (
            forward[i] - sum(lower[k][i] * solution[k] for k in range(i + 1, n))
        ) / lower[i][i]
    return solution


def _inverse_diagonal(lower: list[list[float]], index: int) -> float:
    """The (index, index) entry of the inverted normal matrix - the variance factor."""
    unit = [0.0] * len(lower)
    unit[index] = 1.0
    return _chol_solve(lower, unit)[index]


@dataclass
class _Fit:
    coefficients: list[float]
    lower: list[list[float]]
    residual_variance: float
    total_variance: float
    rows: list[_Row]


def _least_squares(rows: list[_Row], n: int) -> _Fit | None:
    matrix, rhs = _normal_equations(rows, n)
    lower = _cholesky(matrix)
    if lower is None:
        return None
    coefficients = _chol_solve(lower, rhs)

    mean_y = sum(row.y for row in rows) / len(rows)
    residual_sum = 0.0
    total_sum = 0.0
    for row in rows:
        predicted = sum(
            coefficients[index] * row.values[i] for i, index in enumerate(row.indices)
        )
        residual_sum += (row.y - predicted) ** 2
        total_sum += (row.y - mean_y) ** 2
    degrees_of_freedom = max(1, len(rows) - n)
    return _Fit(
        coefficients=coefficients,
        lower=lower,
        residual_variance=residual_sum / degrees_of_freedom,
        total_variance=total_sum,
        rows=rows,
    )


def _residual(fit: _Fit, row: _Row) -> float:
    predicted = sum(
        fit.coefficients[index] * row.values[i] for i, index in enumerate(row.indices)
    )
    return row.y - predicted


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def compute_pace_model(
    *,
    season: int,
    round_: int,
    lap_times: dict[str, dict[int, float]],
    pit_laps: dict[str, list[int]],
    laps_completed: dict[str, int],
    total_laps: int,
    circuit_reference_pace: float | None = None,
) -> RacePaceModel:
    """Derive one race's pace model. Pure function over the cached race data.

    `circuit_reference_pace` is the same circuit's green pace from other cached races
    that fitted as dry (`repository.circuit_dry_reference`). It is what makes a race
    that was wet from lights to flag detectable at all; without it the weather check
    falls back to the within-race regime shift, which such a race passes.
    """
    last_lap = max((max(times) for times in lap_times.values() if times), default=0)
    last_lap = max(last_lap, total_laps or 0)

    field_median = _field_median_by_lap(lap_times, last_lap)
    dispersion = _field_dispersion_by_lap(lap_times, pit_laps, last_lap)
    pit_wave = _pit_wave_by_lap(lap_times, pit_laps, last_lap)
    neutralized = _detect_neutralized_laps(field_median, dispersion, pit_wave)
    green_reference = _green_reference_pace(field_median, neutralized)
    conditions = _detect_conditions(field_median, neutralized, circuit_reference_pace)

    # Stint geometry is worth recording even for a race we refuse to fit: it is what
    # `max_observed_stint_laps` and the audit trail are built from.
    stint_spans: dict[str, list[tuple[int, int]]] = {}
    for driver_id, times in lap_times.items():
        if not times:
            continue
        driver_last = min(max(times), laps_completed.get(driver_id) or max(times))
        stint_spans[driver_id] = segment_stints(pit_laps.get(driver_id, []), driver_last)

    max_observed = max(
        (end - start for spans in stint_spans.values() for start, end in spans), default=0
    )

    if conditions == CONDITIONS_MIXED:
        # Refuse the race rather than fit it. Every stint is recorded as unreliable so
        # the row still explains itself when someone asks why there are no numbers.
        return RacePaceModel(
            season=season,
            round=round_,
            fuel_effect_per_lap=DEFAULT_FUEL_EFFECT,
            fuel_effect_source="default",
            field_median_degradation=None,
            max_observed_stint_laps=max_observed,
            neutralized_laps=sorted(neutralized),
            conditions=conditions,
            green_reference_pace=green_reference,
            stints=[
                StintFit(
                    driver_id=driver_id,
                    stint_number=number,
                    start_lap=start,
                    end_lap=end,
                    laps_used=0,
                    base_pace_seconds=None,
                    degradation_per_lap=None,
                    degradation_stderr=None,
                    r_squared=None,
                    max_tire_age=end - start,
                    quality=QUALITY_UNRELIABLE,
                )
                for driver_id, spans in sorted(stint_spans.items())
                for number, (start, end) in enumerate(spans, start=1)
            ],
        )

    # --- assemble the usable laps -----------------------------------------
    usable: dict[tuple[str, int], list[tuple[int, int, float]]] = {}
    for driver_id, spans in stint_spans.items():
        times = lap_times[driver_id]
        driver_pit_laps = set(pit_laps.get(driver_id, []))
        for number, (start, end) in enumerate(spans, start=1):
            laps: list[tuple[int, int, float]] = []
            for lap in range(start, end + 1):
                seconds = times.get(lap)
                if seconds is None:
                    continue
                if lap == 1:
                    continue  # standing start, turn-1 chaos - not a lap time
                if lap in driver_pit_laps:
                    continue  # in-lap: includes the pit-lane entry
                if lap - 1 in driver_pit_laps:
                    continue  # out-lap: cold tires, not age-0 pace
                if lap in neutralized:
                    continue
                laps.append((lap, lap - start, seconds))
            if len(laps) >= SPARSE_MIN_LAPS:
                usable[(driver_id, number)] = laps

    stint_keys = sorted(usable)
    driver_ids = sorted({driver_id for driver_id, _ in stint_keys})

    def _fallback(source: str) -> RacePaceModel:
        return RacePaceModel(
            season=season,
            round=round_,
            fuel_effect_per_lap=DEFAULT_FUEL_EFFECT,
            fuel_effect_source=source,
            field_median_degradation=None,
            max_observed_stint_laps=max_observed,
            neutralized_laps=sorted(neutralized),
            conditions=conditions,
            green_reference_pace=green_reference,
            stints=_unfitted_stints(stint_spans),
        )

    if not stint_keys:
        return _fallback("default")

    driver_index = {driver_id: 1 + i for i, driver_id in enumerate(driver_ids)}
    stint_index = {key: 1 + len(driver_ids) + i for i, key in enumerate(stint_keys)}
    n = 1 + len(driver_ids) + len(stint_keys)

    all_laps = [lap for laps in usable.values() for lap, _, _ in laps]
    mean_lap = sum(all_laps) / len(all_laps)

    rows: list[_Row] = []
    for key, laps in usable.items():
        driver_id, _ = key
        for lap, age, seconds in laps:
            rows.append(
                _Row(
                    # Column 0 is fuel, entered as -(lap - mean) so a positive
                    # coefficient means the car gets faster as fuel burns off.
                    indices=(0, driver_index[driver_id], stint_index[key]),
                    values=(-(lap - mean_lap), 1.0, float(age)),
                    y=seconds,
                    stint_key=key,
                )
            )

    fit = _least_squares(rows, n)
    if fit is None:
        return _fallback("default")

    # Step B, traffic: one-sided trim, then one refit. Iterating to convergence would
    # flatten a genuinely degrading stint into a straight line.
    trimmed = [row for row in rows if _residual(fit, row) <= TRAFFIC_RESIDUAL_CEILING]
    if len(trimmed) > n and len(trimmed) < len(rows):
        refit = _least_squares(trimmed, n)
        if refit is not None:
            fit = refit

    fuel_effect = fit.coefficients[0]
    low, high = FUEL_EFFECT_BOUNDS
    # Column indices into the Cholesky factor. They stop matching the coefficient
    # indices once fuel is pinned and its column drops out of the solve.
    stderr_offset = 0
    if low <= fuel_effect <= high:
        fuel_source = "fitted"
    else:
        fuel_effect = min(high, max(low, fuel_effect))
        fuel_source = "clamped"
        # Refit with fuel pinned, so the slopes belong to the coefficient we actually
        # use rather than to the one we rejected. Moving fuel to the left-hand side
        # drops column 0, so the remaining columns shift down by one.
        pinned = [
            _Row(
                indices=tuple(index - 1 for index in row.indices[1:]),
                values=row.values[1:],
                y=row.y - fuel_effect * row.values[0],
                stint_key=row.stint_key,
            )
            for row in fit.rows
        ]
        pinned_fit = _least_squares(pinned, n - 1)
        if pinned_fit is None:
            return _fallback("default")
        # Put fuel back at coefficient 0 so `driver_index` / `stint_index` still read
        # correctly; only the Cholesky factor keeps the shifted numbering.
        fit = _Fit(
            coefficients=[fuel_effect, *pinned_fit.coefficients],
            lower=pinned_fit.lower,
            residual_variance=pinned_fit.residual_variance,
            total_variance=pinned_fit.total_variance,
            rows=fit.rows,
        )
        stderr_offset = 1

    used_by_stint: dict[tuple[str, int], int] = {}
    ss_res_by_stint: dict[tuple[str, int], float] = {}
    ss_tot_by_stint: dict[tuple[str, int], float] = {}
    mean_by_stint: dict[tuple[str, int], float] = {}
    for row in fit.rows:
        used_by_stint[row.stint_key] = used_by_stint.get(row.stint_key, 0) + 1
        mean_by_stint[row.stint_key] = mean_by_stint.get(row.stint_key, 0.0) + row.y
    for key in mean_by_stint:
        mean_by_stint[key] /= used_by_stint[key]
    for row in fit.rows:
        residual = _residual(fit, row)
        ss_res_by_stint[row.stint_key] = ss_res_by_stint.get(row.stint_key, 0.0) + residual**2
        ss_tot_by_stint[row.stint_key] = (
            ss_tot_by_stint.get(row.stint_key, 0.0) + (row.y - mean_by_stint[row.stint_key]) ** 2
        )

    stints: list[StintFit] = []
    for driver_id, spans in sorted(stint_spans.items()):
        for number, (start, end) in enumerate(spans, start=1):
            key = (driver_id, number)
            laps_used = used_by_stint.get(key, 0)
            if key not in stint_index or laps_used < SPARSE_MIN_LAPS:
                stints.append(
                    StintFit(
                        driver_id=driver_id,
                        stint_number=number,
                        start_lap=start,
                        end_lap=end,
                        laps_used=laps_used,
                        base_pace_seconds=None,
                        degradation_per_lap=None,
                        degradation_stderr=None,
                        r_squared=None,
                        max_tire_age=end - start,
                        quality=QUALITY_UNRELIABLE,
                    )
                )
                continue

            index = stint_index[key]
            degradation = fit.coefficients[index]
            stderr = (
                fit.residual_variance * _inverse_diagonal(fit.lower, index - stderr_offset)
            ) ** 0.5
            intercept = fit.coefficients[driver_index[driver_id]]
            base_pace = intercept - fuel_effect * (start - mean_lap)
            ss_tot = ss_tot_by_stint.get(key, 0.0)
            r_squared = (
                None if ss_tot <= 0 else max(0.0, 1.0 - ss_res_by_stint.get(key, 0.0) / ss_tot)
            )

            if degradation < MIN_PLAUSIBLE_DEGRADATION:
                quality = QUALITY_UNRELIABLE
            elif laps_used >= GOOD_MIN_LAPS:
                quality = QUALITY_GOOD
            else:
                quality = QUALITY_SPARSE

            stints.append(
                StintFit(
                    driver_id=driver_id,
                    stint_number=number,
                    start_lap=start,
                    end_lap=end,
                    laps_used=laps_used,
                    base_pace_seconds=round(base_pace, 4),
                    degradation_per_lap=round(degradation, 5),
                    degradation_stderr=round(stderr, 5),
                    r_squared=None if r_squared is None else round(r_squared, 4),
                    max_tire_age=end - start,
                    quality=quality,
                )
            )

    field_median_degradation = _field_median_degradation(stints)

    return RacePaceModel(
        season=season,
        round=round_,
        fuel_effect_per_lap=round(fuel_effect, 5),
        fuel_effect_source=fuel_source,
        field_median_degradation=field_median_degradation,
        max_observed_stint_laps=max_observed,
        neutralized_laps=sorted(neutralized),
        conditions=conditions,
        green_reference_pace=green_reference,
        stints=stints,
    )


def _unfitted_stints(stint_spans: dict[str, list[tuple[int, int]]]) -> list[StintFit]:
    return [
        StintFit(
            driver_id=driver_id,
            stint_number=number,
            start_lap=start,
            end_lap=end,
            laps_used=0,
            base_pace_seconds=None,
            degradation_per_lap=None,
            degradation_stderr=None,
            r_squared=None,
            max_tire_age=end - start,
            quality=QUALITY_UNRELIABLE,
        )
        for driver_id, spans in sorted(stint_spans.items())
        for number, (start, end) in enumerate(spans, start=1)
    ]


def _field_median_degradation(stints: list[StintFit]) -> float | None:
    """Tier 3: the median across drivers, not across stints.

    Taking it across stints would weight a three-stopper three times as heavily as a
    one-stopper, which is a strategy fact rather than a tire fact.
    """
    per_driver: dict[str, list[StintFit]] = {}
    for stint in stints:
        if stint.quality == QUALITY_GOOD and stint.degradation_per_lap is not None:
            per_driver.setdefault(stint.driver_id, []).append(stint)
    values = [
        sum(s.degradation_per_lap * s.laps_used for s in group)
        / sum(s.laps_used for s in group)
        for group in per_driver.values()
    ]
    return round(median(values), 5) if values else None
