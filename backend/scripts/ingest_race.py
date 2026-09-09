"""Fetch one race from Jolpica and cache it in Postgres.

    cd backend
    ./.venv/Scripts/python.exe -m scripts.ingest_race 2024 16

Exit codes: 0 ok, 1 error, 2 race not found upstream (empty Races array).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Allow running as a plain script from anywhere, not just `python -m` inside backend/.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import close_pool  # noqa: E402
from app.ingest import RaceNotFoundError, ingest_race  # noqa: E402
from app.repository import ensure_pace_model  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("season", type=int, help="Season year, e.g. 2024")
    parser.add_argument("round", type=int, help="Round within the season, e.g. 16")
    args = parser.parse_args()

    try:
        report = ingest_race(args.season, args.round)
        # The pace model is fitted across the whole field at once, so it can only be
        # derived once all three fetches have landed.
        model = ensure_pace_model(args.season, args.round)
    except RaceNotFoundError as exc:
        print(f"not found: {exc}", file=sys.stderr)
        return 2
    finally:
        # The pool runs worker threads; leaving them to the interpreter's finalizer
        # raises PythonFinalizationError on the way out. The server does this from its
        # lifespan hook - short-lived scripts have to do it themselves.
        close_pool()

    print(report.as_text())
    if model is not None:
        print(
            f"pace model      conditions={model.conditions} "
            f"fuel={model.fuel_effect_per_lap} ({model.fuel_effect_source}) "
            f"field_median_degradation={model.field_median_degradation} "
            f"A_race={model.max_observed_stint_laps}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
