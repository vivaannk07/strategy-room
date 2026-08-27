"""POST /api/simulate.

Validates the hypothetical strategy, loads the race baseline out of the cache (fetching
the race from Jolpica first if it isn't cached), and runs the Monte Carlo described in
simulation-logic.md. The engine itself lives in app/simulation.py.
"""

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool

from app import repository, simulation
from app.db import connect
from app.routers.races import ensure_cached
from app.schemas import SimulationRequest, SimulationResponse

router = APIRouter(prefix="/api", tags=["simulate"])

# Each iteration is cheap, but 500 is the documented working point and an unbounded
# count would let one request occupy a worker thread indefinitely.
MAX_SIMULATIONS = 5000


def _load_baseline(season: int, round_: int) -> repository.RaceBaseline | None:
    with connect() as conn:
        return repository.load_race_baseline(conn, season, round_)


def _run(request: SimulationRequest, baseline: repository.RaceBaseline) -> SimulationResponse:
    """The synchronous half: validation plus the Monte Carlo."""
    if not baseline.has_driver(request.driver_id):
        raise HTTPException(
            status_code=404,
            detail=(
                f"Driver {request.driver_id!r} did not take part in season "
                f"{request.season} round {request.round}."
            ),
        )
    try:
        return simulation.run_simulation(request, baseline)
    except simulation.InvalidStrategyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/simulate",
    response_model=SimulationResponse,
    responses={
        400: {"description": "Invalid strategy (pit lap outside race length, unknown compound)"},
        404: {"description": "Race or driver not found"},
    },
)
async def simulate(request: SimulationRequest) -> SimulationResponse:
    """Run the Monte Carlo simulation for a hypothetical strategy against the baseline."""
    if not 1 <= request.num_simulations <= MAX_SIMULATIONS:
        raise HTTPException(
            status_code=400,
            detail=f"num_simulations must be between 1 and {MAX_SIMULATIONS}.",
        )

    # Same fetch-on-demand path as GET /api/races/{season}/{round}: a race can be
    # simulated without having been opened in the UI first, and a miss on the read is
    # what tells us to go and get it.
    baseline = await run_in_threadpool(_load_baseline, request.season, request.round)
    if baseline is None:
        await ensure_cached(request.season, request.round)
        baseline = await run_in_threadpool(_load_baseline, request.season, request.round)
    if baseline is None:
        raise HTTPException(
            status_code=404,
            detail=f"No cached data for season {request.season} round {request.round}.",
        )

    return await run_in_threadpool(_run, request, baseline)
