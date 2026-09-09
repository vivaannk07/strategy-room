"""Fit and cache the derived pace model for one cached race, and print it.

    cd backend
    ./.venv/Scripts/python.exe -m scripts.fit_pace_model 2024 16
    ./.venv/Scripts/python.exe -m scripts.fit_pace_model 2024 16 --force
    ./.venv/Scripts/python.exe -m scripts.fit_pace_model --all

The race must already be ingested. `--force` refits even when the stored model is
current, which is what you want while the fit itself is being changed; a `MODEL_VERSION`
bump is the normal way to invalidate one.

`--all` refits every cached race, twice. Twice because the weather check reads the
circuit's green pace out of *other* races' stored models, so a race refitted before its
neighbour at the same circuit has no reference to use; the second pass gives every race
the same view of the cache. Run it after a `MODEL_VERSION` bump or a new ingest batch.

Exit codes: 0 ok, 1 error, 2 race not cached.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import close_pool, connect  # noqa: E402
from app.pace_model import compute_pace_model  # noqa: E402
from app.repository import (  # noqa: E402
    circuit_dry_reference,
    ensure_pace_model,
    load_race_baseline,
    store_pace_model,
)


def _refit(season: int, round_: int):
    with connect() as conn:
        return _refit_on(conn, season, round_)


def _refit_on(conn, season: int, round_: int):
    baseline = load_race_baseline(conn, season, round_)
    if baseline is None:
        return None
    model = compute_pace_model(
        season=season,
        round_=round_,
        lap_times=baseline.lap_times,
        pit_laps=baseline.pit_laps,
        laps_completed=baseline.laps_completed,
        total_laps=baseline.total_laps,
        circuit_reference_pace=circuit_dry_reference(conn, season, round_),
    )
    store_pace_model(conn, model)
    return model


def _refit_all(quiet: bool) -> int:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT season, round FROM races ORDER BY season, round")
            races = cur.fetchall()
        # Pass 1 fills in every race's own green pace; pass 2 is the one whose weather
        # verdicts have the whole cache behind them. Only pass 2 is reported.
        for _pass in (1, 2):
            models = [_refit_on(conn, season, round_) for season, round_ in races]
    for model in models:
        if model is not None:
            _print_model(model, quiet=quiet)
    print(f"refitted {len(races)} races")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("season", type=int, nargs="?")
    parser.add_argument("round", type=int, nargs="?")
    parser.add_argument("--force", action="store_true", help="Refit even if current")
    parser.add_argument("--all", action="store_true", help="Refit every cached race")
    parser.add_argument("--quiet", action="store_true", help="Summary only, no stint table")
    args = parser.parse_args()

    if args.all:
        try:
            return _refit_all(args.quiet)
        finally:
            close_pool()

    if args.season is None or args.round is None:
        parser.error("give a season and round, or --all")

    try:
        model = _refit(args.season, args.round) if args.force else ensure_pace_model(
            args.season, args.round
        )
    finally:
        close_pool()

    if model is None:
        print(f"not cached: season {args.season} round {args.round}", file=sys.stderr)
        return 2

    _print_model(model, quiet=args.quiet)
    return 0


def _print_model(model, *, quiet: bool) -> None:
    print(
        f"season {model.season} round {model.round}: conditions={model.conditions} "
        f"fuel={model.fuel_effect_per_lap} ({model.fuel_effect_source}) "
        f"field_median_degradation={model.field_median_degradation} "
        f"green_pace={model.green_reference_pace} "
        f"A_race={model.max_observed_stint_laps} "
        f"neutralized={model.neutralized_laps or '[]'}"
    )
    if quiet:
        return
    for stint in model.stints:
        print(
            f"  {stint.driver_id:<16} stint {stint.stint_number} "
            f"laps {stint.start_lap:>2}-{stint.end_lap:<2} used={stint.laps_used:>2} "
            f"deg={stint.degradation_per_lap} se={stint.degradation_stderr} "
            f"base={stint.base_pace_seconds} r2={stint.r_squared} {stint.quality}"
        )


if __name__ == "__main__":
    raise SystemExit(main())
