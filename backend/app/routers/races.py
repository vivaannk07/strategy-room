"""GET /api/races, GET /api/races/{season}/{round} and its per-driver laps.

Reads come out of the Postgres cache. A race that isn't cached yet is fetched from
Jolpica on demand and stored, so the first request for a race is slow (a dozen-odd
upstream requests) and every one after it is a local query.

The cache layer is synchronous by design (see app/db.py), so both the lookup and the
ingest are pushed to a worker thread rather than awaited on the event loop.
"""

import asyncio
from collections import defaultdict

from fastapi import APIRouter, HTTPException, Query
from fastapi.concurrency import run_in_threadpool

from app import repository
from app.db import connect
from app.jolpica import JolpicaError, RaceNotFoundError
from app.schemas import DriverLap, RaceDetail, RaceSummary

router = APIRouter(prefix="/api/races", tags=["races"])

# One in-flight ingest per race. Without this, N concurrent requests for the same cold
# race would each run the full Jolpica fetch; the upserts are idempotent so the result
# would still be correct, just N times the upstream traffic.
_ingest_locks: dict[tuple[int, int], asyncio.Lock] = defaultdict(asyncio.Lock)


async def ensure_cached(season: int, round_: int) -> None:
    """Populate the cache for one race if needed, translating upstream failures to HTTP."""
    async with _ingest_locks[(season, round_)]:
        try:
            await run_in_threadpool(repository.ensure_cached, season, round_)
        except RaceNotFoundError as exc:
            # Jolpica answers 200 with an empty Races array; the contract says 404.
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except JolpicaError as exc:
            raise HTTPException(status_code=502, detail=f"Jolpica fetch failed: {exc}") from exc


def _read_summaries(season: int | None, limit: int) -> list[RaceSummary]:
    with connect() as conn:
        return repository.list_race_summaries(conn, season, limit)


def _read_detail(season: int, round_: int) -> RaceDetail | None:
    with connect() as conn:
        return repository.load_race_detail(conn, season, round_)


def _read_driver_laps(season: int, round_: int, driver_id: str) -> list[DriverLap] | None:
    with connect() as conn:
        return repository.load_driver_laps(conn, season, round_, driver_id)


@router.get("", response_model=list[RaceSummary])
async def list_races(
    season: int | None = Query(default=None, description="Filter by season year, e.g. 2024"),
    limit: int = Query(default=50, ge=1, description="Max results"),
) -> list[RaceSummary]:
    """List past races available to select from, most recent seasons first."""
    return await run_in_threadpool(_read_summaries, season, limit)


@router.get(
    "/{season}/{round}",
    response_model=RaceDetail,
    responses={404: {"description": "Season/round not found upstream"}},
)
async def get_race(season: int, round: int) -> RaceDetail:
    """Full detail for one race - drivers, actual pit stops, actual results."""
    # Read first and treat a miss as the signal to ingest, rather than asking whether
    # the race is cached and then reading it. The hit path is the common one and this
    # keeps it to a single set of queries.
    detail = await run_in_threadpool(_read_detail, season, round)
    if detail is not None:
        return detail

    await ensure_cached(season, round)

    detail = await run_in_threadpool(_read_detail, season, round)
    if detail is None:
        # ensure_cached returned clean, so the race exists upstream but left no rows.
        raise HTTPException(
            status_code=404, detail=f"No cached data for season {season} round {round}."
        )
    return detail


@router.get(
    "/{season}/{round}/drivers/{driver_id}/laps",
    response_model=list[DriverLap],
    responses={404: {"description": "Race not found upstream, or driver not in this race"}},
)
async def get_driver_laps(season: int, round: int, driver_id: str) -> list[DriverLap]:
    """One driver's recorded lap times and positions for a race, in lap order."""
    # Same fetch-on-demand path as get_race: ensure_cached is a no-op for a cached race.
    await ensure_cached(season, round)

    laps = await run_in_threadpool(_read_driver_laps, season, round, driver_id)
    if laps is None:
        raise HTTPException(
            status_code=404,
            detail=f"Driver {driver_id!r} did not take part in season {season} round {round}.",
        )
    return laps
