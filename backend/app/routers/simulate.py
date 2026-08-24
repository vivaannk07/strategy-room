"""POST /api/simulate.

Stub handler: returns the placeholder payload from api-contract.md. The Monte Carlo
run described in simulation-logic.md isn't wired up yet.
"""

from fastapi import APIRouter

from app.schemas import (
    LapComparison,
    SimulationRequest,
    SimulationResponse,
    SimulationSummary,
)

router = APIRouter(prefix="/api", tags=["simulate"])


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
    # TODO: validate the strategy (400), load the race baseline (404), then run
    # request.num_simulations iterations of the lap-by-lap model.
    return SimulationResponse(
        season=request.season,
        round=request.round,
        driver_id=request.driver_id,
        baseline_time_seconds=4480.727,
        simulated=SimulationSummary(
            mean_time_seconds=4476.5,
            median_time_seconds=4476.2,
            delta_vs_actual_seconds=-4.2,
            finish_position_distribution={1: 412, 2: 78, 3: 10},
        ),
        lap_by_lap=[
            LapComparison(lap=1, hypothetical_position=2, actual_position=2),
            LapComparison(lap=2, hypothetical_position=2, actual_position=2),
        ],
    )
