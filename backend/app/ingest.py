"""Fetch a race from Jolpica and cache it in Postgres.

One race is one transaction: either every table gets its rows or none do, so a
half-populated race can never be mistaken for a cached one. Everything is an upsert
keyed on the natural unique constraints from schema.sql, which makes re-ingesting the
same race idempotent - useful when Jolpica backfills provisional results.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import psycopg

from app import jolpica
from app.db import connect, missing_tables
from app.jolpica import RaceBundle, RaceNotFoundError

__all__ = ["IngestReport", "cache_race", "ingest_race", "RaceNotFoundError"]


@dataclass
class IngestReport:
    """What a single race ingest actually did, per table."""

    season: int
    round: int
    race_name: str
    total_laps: int | None
    # Rows returned by Jolpica.
    fetched: dict[str, int] = field(default_factory=dict)
    # Rows now in each table for this race, counted after commit.
    stored: dict[str, int] = field(default_factory=dict)
    # Lap/pit-stop rows dropped because their driverId never appeared in the
    # results payload, so there'd be no `drivers` row to satisfy the FK.
    skipped_unknown_drivers: dict[str, list[str]] = field(default_factory=dict)

    def as_text(self) -> str:
        lines = [
            f"{self.race_name} - season {self.season}, round {self.round} "
            f"(total_laps={self.total_laps})",
            f"{'table':<14}{'fetched':>9}{'stored':>9}",
        ]
        for table in ("drivers", "races", "race_results", "laps", "pit_stops"):
            lines.append(
                f"{table:<14}{self.fetched.get(table, 0):>9}{self.stored.get(table, 0):>9}"
            )
        for table, drivers in self.skipped_unknown_drivers.items():
            lines.append(f"skipped in {table}: {', '.join(sorted(set(drivers)))}")
        return "\n".join(lines)


def _upsert_drivers(cur: psycopg.Cursor, bundle: RaceBundle) -> int:
    # A driver can appear once per result row only, but dedupe anyway so executemany
    # never hits the same PK twice inside one statement.
    drivers = {result.driver.id: result.driver for result in bundle.results}
    if not drivers:
        return 0
    cur.executemany(
        """
        INSERT INTO drivers (id, given_name, family_name, code, permanent_number, nationality)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET
            given_name       = EXCLUDED.given_name,
            family_name      = EXCLUDED.family_name,
            code             = COALESCE(EXCLUDED.code, drivers.code),
            permanent_number = COALESCE(EXCLUDED.permanent_number, drivers.permanent_number),
            nationality      = COALESCE(EXCLUDED.nationality, drivers.nationality)
        """,
        [
            (d.id, d.given_name, d.family_name, d.code, d.permanent_number, d.nationality)
            for d in drivers.values()
        ],
    )
    return len(drivers)


def _upsert_race(cur: psycopg.Cursor, bundle: RaceBundle) -> None:
    race = bundle.race
    cur.execute(
        """
        INSERT INTO races (season, round, race_name, circuit_id, circuit_name, date, total_laps)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (season, round) DO UPDATE SET
            race_name    = EXCLUDED.race_name,
            circuit_id   = EXCLUDED.circuit_id,
            circuit_name = EXCLUDED.circuit_name,
            date         = EXCLUDED.date,
            total_laps   = EXCLUDED.total_laps
        """,
        (
            race.season,
            race.round,
            race.race_name,
            race.circuit_id,
            race.circuit_name,
            race.date,
            race.total_laps,
        ),
    )


def _upsert_results(cur: psycopg.Cursor, bundle: RaceBundle) -> int:
    if not bundle.results:
        return 0
    race = bundle.race
    cur.executemany(
        """
        INSERT INTO race_results (
            race_season, race_round, driver_id, constructor_id, constructor_name,
            grid, position, position_text, points, laps_completed, status, finish_time_ms
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (race_season, race_round, driver_id) DO UPDATE SET
            constructor_id   = EXCLUDED.constructor_id,
            constructor_name = EXCLUDED.constructor_name,
            grid             = EXCLUDED.grid,
            position         = EXCLUDED.position,
            position_text    = EXCLUDED.position_text,
            points           = EXCLUDED.points,
            laps_completed   = EXCLUDED.laps_completed,
            status           = EXCLUDED.status,
            finish_time_ms   = EXCLUDED.finish_time_ms
        """,
        [
            (
                race.season,
                race.round,
                r.driver.id,
                r.constructor_id,
                r.constructor_name,
                r.grid,
                r.position,
                r.position_text,
                r.points,
                r.laps_completed,
                r.status,
                r.finish_time_ms,
            )
            for r in bundle.results
        ],
    )
    return len(bundle.results)


def _upsert_laps(cur: psycopg.Cursor, bundle: RaceBundle, known_drivers: set[str]) -> tuple[int, list[str]]:
    race = bundle.race
    rows = [lap for lap in bundle.laps if lap.driver_id in known_drivers]
    skipped = [lap.driver_id for lap in bundle.laps if lap.driver_id not in known_drivers]
    if rows:
        cur.executemany(
            """
            INSERT INTO laps (
                race_season, race_round, driver_id, lap_number, position, lap_time_seconds
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (race_season, race_round, driver_id, lap_number) DO UPDATE SET
                position         = EXCLUDED.position,
                lap_time_seconds = EXCLUDED.lap_time_seconds
            """,
            [
                (
                    race.season,
                    race.round,
                    lap.driver_id,
                    lap.lap_number,
                    lap.position,
                    lap.lap_time_seconds,
                )
                for lap in rows
            ],
        )
    return len(rows), skipped


def _upsert_pit_stops(
    cur: psycopg.Cursor, bundle: RaceBundle, known_drivers: set[str]
) -> tuple[int, list[str]]:
    race = bundle.race
    rows = [stop for stop in bundle.pit_stops if stop.driver_id in known_drivers]
    skipped = [stop.driver_id for stop in bundle.pit_stops if stop.driver_id not in known_drivers]
    if rows:
        cur.executemany(
            """
            INSERT INTO pit_stops (
                race_season, race_round, driver_id, stop, lap, duration_seconds, time_of_day
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (race_season, race_round, driver_id, stop) DO UPDATE SET
                lap              = EXCLUDED.lap,
                duration_seconds = EXCLUDED.duration_seconds,
                time_of_day      = EXCLUDED.time_of_day
            """,
            [
                (
                    race.season,
                    race.round,
                    stop.driver_id,
                    stop.stop,
                    stop.lap,
                    stop.duration_seconds,
                    stop.time_of_day,
                )
                for stop in rows
            ],
        )
    return len(rows), skipped


def _count_stored(cur: psycopg.Cursor, season: int, round_: int) -> dict[str, int]:
    """Rows actually in each table for this race, read back after the write."""
    counts: dict[str, int] = {}
    for table in ("race_results", "laps", "pit_stops"):
        cur.execute(
            f"SELECT count(*) FROM {table} WHERE race_season = %s AND race_round = %s",
            (season, round_),
        )
        counts[table] = cur.fetchone()[0]

    cur.execute("SELECT count(*) FROM races WHERE season = %s AND round = %s", (season, round_))
    counts["races"] = cur.fetchone()[0]

    cur.execute(
        "SELECT count(DISTINCT driver_id) FROM race_results "
        "WHERE race_season = %s AND race_round = %s",
        (season, round_),
    )
    counts["drivers"] = cur.fetchone()[0]
    return counts


def cache_race(bundle: RaceBundle, conn: psycopg.Connection | None = None) -> IngestReport:
    """Write an already-fetched bundle to Postgres in a single transaction."""
    race = bundle.race
    report = IngestReport(
        season=race.season,
        round=race.round,
        race_name=race.race_name,
        total_laps=race.total_laps,
    )

    def _write(connection: psycopg.Connection) -> None:
        gaps = missing_tables(connection)
        if gaps:
            raise RuntimeError(
                f"Cache tables missing from the database: {', '.join(gaps)}. "
                "Run backend/schema.sql against DATABASE_URL first."
            )

        with connection.cursor() as cur:
            report.fetched["drivers"] = _upsert_drivers(cur, bundle)
            _upsert_race(cur, bundle)
            report.fetched["races"] = 1
            report.fetched["race_results"] = _upsert_results(cur, bundle)

            known = {r.driver.id for r in bundle.results}
            lap_rows, lap_skipped = _upsert_laps(cur, bundle, known)
            stop_rows, stop_skipped = _upsert_pit_stops(cur, bundle, known)
            report.fetched["laps"] = len(bundle.laps)
            report.fetched["pit_stops"] = len(bundle.pit_stops)
            if lap_skipped:
                report.skipped_unknown_drivers["laps"] = lap_skipped
            if stop_skipped:
                report.skipped_unknown_drivers["pit_stops"] = stop_skipped
            # Written-row counts feed the post-commit reconciliation below.
            report.stored["laps"] = lap_rows
            report.stored["pit_stops"] = stop_rows

    if conn is not None:
        _write(conn)
        with conn.cursor() as cur:
            report.stored = _count_stored(cur, race.season, race.round)
        return report

    with connect() as connection:
        _write(connection)

    # Re-read on a fresh connection so the counts reflect what survived the commit.
    with connect() as connection, connection.cursor() as cur:
        report.stored = _count_stored(cur, race.season, race.round)
    return report


def ingest_race(season: int, round_: int) -> IngestReport:
    """Fetch one race from Jolpica and cache it. Raises `RaceNotFoundError` if absent."""
    bundle = jolpica.fetch_race_bundle(season, round_)
    return cache_race(bundle)
