"""Pydantic models mirroring the response shapes in api-contract.md.

Field names are snake_case and values are typed here; the casting from Jolpica's
all-strings camelCase payloads happens in the (not yet written) ingest layer.
"""

import datetime

from pydantic import BaseModel, Field

# Valid values for `compound_in`. Kept as a plain tuple rather than a Literal so an
# unknown compound can be rejected with a 400, as the contract specifies, instead of
# FastAPI's default 422 for a type mismatch.
COMPOUNDS = ("soft", "medium", "hard", "intermediate", "wet")


class RaceSummary(BaseModel):
    """One entry in GET /api/races."""

    season: int
    round: int
    race_name: str
    circuit_id: str
    circuit_name: str
    date: datetime.date


class PitStop(BaseModel):
    """An actual pit stop. Carries no compound — Jolpica doesn't publish tire data."""

    stop: int
    lap: int
    duration_seconds: float


class RaceDriver(BaseModel):
    """One driver's participation in a race, as returned by GET /api/races/{season}/{round}."""

    driver_id: str
    # Nullable: older seasons have no Driver.code.
    driver_code: str | None
    driver_name: str
    constructor_id: str
    constructor_name: str
    grid: int
    actual_pit_stops: list[PitStop]
    actual_finish_position: int
    actual_position_text: str
    actual_status: str
    actual_laps_completed: int
    # null for any driver with no Time object upstream (retirements).
    actual_finish_time_seconds: float | None


class RaceDetail(RaceSummary):
    """GET /api/races/{season}/{round}."""

    # Derived from the winner's lap count — Jolpica has no total_laps field.
    total_laps: int
    drivers: list[RaceDriver]


class StrategyStop(BaseModel):
    """A hypothetical pit stop. `compound_in` is user input only."""

    lap: int
    compound_in: str


class SimulationRequest(BaseModel):
    """POST /api/simulate request body."""

    season: int
    round: int
    driver_id: str
    strategy: list[StrategyStop]
    num_simulations: int = 500


class SimulationSummary(BaseModel):
    mean_time_seconds: float
    median_time_seconds: float
    # null when the driver has no baseline race time (retirement).
    delta_vs_actual_seconds: float | None
    # Finish position -> how many of the num_simulations runs ended there.
    # Serializes with string keys, e.g. {"1": 412}.
    finish_position_distribution: dict[int, int]


class LapComparison(BaseModel):
    lap: int
    hypothetical_position: int
    actual_position: int


class SimulationResponse(BaseModel):
    """POST /api/simulate response."""

    season: int
    round: int
    driver_id: str
    baseline_time_seconds: float | None
    simulated: SimulationSummary
    # Median run only, not all iterations — this feeds the Compare view chart.
    lap_by_lap: list[LapComparison] = Field(default_factory=list)
