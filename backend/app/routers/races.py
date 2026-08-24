"""GET /api/races and GET /api/races/{season}/{round}.

Stub handlers: they return the placeholder payloads from api-contract.md so the
frontend can be built against the real response shapes. No Jolpica fetch, no cache
lookup, no filtering yet.
"""

import datetime

from fastapi import APIRouter, Query

from app.schemas import PitStop, RaceDetail, RaceDriver, RaceSummary

router = APIRouter(prefix="/api/races", tags=["races"])


@router.get("", response_model=list[RaceSummary])
async def list_races(
    season: int | None = Query(default=None, description="Filter by season year, e.g. 2024"),
    limit: int = Query(default=50, ge=1, description="Max results"),
) -> list[RaceSummary]:
    """List past races available to select from, most recent seasons first."""
    # TODO: read from the races cache table, lazily populating it from Jolpica.
    return [
        RaceSummary(
            season=2024,
            round=16,
            race_name="Italian Grand Prix",
            circuit_id="monza",
            circuit_name="Autodromo Nazionale di Monza",
            date=datetime.date(2024, 9, 1),
        )
    ]


@router.get(
    "/{season}/{round}",
    response_model=RaceDetail,
    responses={404: {"description": "Season/round not found upstream"}},
)
async def get_race(season: int, round: int) -> RaceDetail:
    """Full detail for one race — drivers, actual pit stops, actual results."""
    # TODO: fetch /results.json and /pitstops.json, join on driverId, derive total_laps
    # from the winner's lap count, and raise 404 when Jolpica returns an empty Races array.
    return RaceDetail(
        season=2024,
        round=16,
        race_name="Italian Grand Prix",
        circuit_id="monza",
        circuit_name="Autodromo Nazionale di Monza",
        date=datetime.date(2024, 9, 1),
        total_laps=53,
        drivers=[
            RaceDriver(
                driver_id="leclerc",
                driver_code="LEC",
                driver_name="Charles Leclerc",
                constructor_id="ferrari",
                constructor_name="Ferrari",
                grid=4,
                actual_pit_stops=[PitStop(stop=1, lap=15, duration_seconds=24.109)],
                actual_finish_position=1,
                actual_position_text="1",
                actual_status="Finished",
                actual_laps_completed=53,
                actual_finish_time_seconds=4480.727,
            )
        ],
    )
