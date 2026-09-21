"""Read queries against the Postgres cache.

Every function here assumes the race is already cached - filling the cache is
`app.ingest`'s job, and `ensure_cached` is the seam between the two. Kept separate
from `app/db.py` so that module stays purely about connections.

psycopg maps `numeric` to `Decimal`; everything crossing into the Pydantic layer is
cast to `float` here so the response models never see a Decimal.
"""

from __future__ import annotations

from collections import defaultdict
from statistics import median

import psycopg

from app.db import connect
from app.ingest import ingest_race
from app.jolpica import RaceNotFoundError
from app.pace_model import MODEL_VERSION, RacePaceModel, StintFit, compute_pace_model
from app.schemas import DriverLap, PitStop, RaceDetail, RaceDriver, RaceSummary

__all__ = [
    "RaceNotFoundError",
    "RaceBaseline",
    "circuit_dry_reference",
    "ensure_cached",
    "ensure_pace_model",
    "list_race_summaries",
    "load_driver_laps",
    "load_pace_model",
    "load_race_baseline",
    "load_race_detail",
    "race_is_cached",
    "store_pace_model",
]


def _f(value) -> float | None:
    """Decimal/None -> float/None."""
    return None if value is None else float(value)


# ---------------------------------------------------------------------------
# Cache state
# ---------------------------------------------------------------------------


def race_is_cached(conn: psycopg.Connection, season: int, round_: int) -> bool:
    """Is this race in the cache?

    A `races` row is a sufficient marker: `cache_race` writes every table for a race
    inside one transaction, so a row here means the results/laps/pit stops landed too.
    """
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM races WHERE season = %s AND round = %s", (season, round_))
        return cur.fetchone() is not None


def ensure_cached(season: int, round_: int) -> None:
    """Cache the race if it isn't already. Raises `RaceNotFoundError` if it doesn't exist.

    Synchronous and potentially slow (a cold race is a dozen-odd Jolpica requests), so
    callers on the request path must push it to a worker thread - see `app/db.py`.
    """
    with connect() as conn:
        if race_is_cached(conn, season, round_):
            return
    ingest_race(season, round_)
    # The pace model is fitted across every driver in the race at once, so it can only
    # be derived once all three Jolpica fetches have landed - i.e. here, not inside
    # `ingest_race`.
    ensure_pace_model(season, round_)


# ---------------------------------------------------------------------------
# GET /api/races
# ---------------------------------------------------------------------------


def list_race_summaries(
    conn: psycopg.Connection, season: int | None, limit: int
) -> list[RaceSummary]:
    """Cached races, most recent first. Reads only - the cache is filled one race at a time."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT season, round, race_name, circuit_id, circuit_name, date
            FROM races
            WHERE (%s::integer IS NULL OR season = %s)
            ORDER BY season DESC, round DESC
            LIMIT %s
            """,
            (season, season, limit),
        )
        rows = cur.fetchall()

    return [
        RaceSummary(
            season=row[0],
            round=row[1],
            race_name=row[2],
            circuit_id=row[3],
            circuit_name=row[4],
            date=row[5],
        )
        for row in rows
    ]


# ---------------------------------------------------------------------------
# GET /api/races/{season}/{round}
# ---------------------------------------------------------------------------


# Race, results and pit stops in one statement. Split across three queries this cost
# three sequential round trips to a database in another region, which was the whole
# response time; the join makes a cache hit a single one. The LEFT JOINs are what let
# a race with no results rows still come back (as a race with an empty driver list)
# rather than looking uncached.
_RACE_DETAIL_SQL = """
SELECT ra.season, ra.round, ra.race_name, ra.circuit_id, ra.circuit_name, ra.date,
       ra.total_laps,
       r.driver_id, d.code, d.given_name, d.family_name,
       r.constructor_id, r.constructor_name, r.grid,
       r.position, r.position_text, r.status, r.laps_completed, r.finish_time_ms,
       p.stops
FROM races ra
LEFT JOIN race_results r ON r.race_season = ra.season AND r.race_round = ra.round
LEFT JOIN drivers d ON d.id = r.driver_id
LEFT JOIN LATERAL (
    SELECT json_agg(
               json_build_object('stop', ps.stop, 'lap', ps.lap,
                                 'duration_seconds', ps.duration_seconds)
               ORDER BY ps.stop
           ) AS stops
    FROM pit_stops ps
    WHERE ps.race_season = ra.season
      AND ps.race_round = ra.round
      AND ps.driver_id = r.driver_id
) p ON true
WHERE ra.season = %s AND ra.round = %s
ORDER BY r.position
"""


def load_race_detail(conn: psycopg.Connection, season: int, round_: int) -> RaceDetail | None:
    """Assemble the GET /api/races/{season}/{round} payload. None if the race isn't cached."""
    with conn.cursor() as cur:
        cur.execute(_RACE_DETAIL_SQL, (season, round_))
        rows = cur.fetchall()

    if not rows:
        return None

    drivers: list[RaceDriver] = []
    for row in rows:
        (
            _season,
            _round,
            _race_name,
            _circuit_id,
            _circuit_name,
            _date,
            _total_laps,
            driver_id,
            code,
            given_name,
            family_name,
            constructor_id,
            constructor_name,
            grid,
            position,
            position_text,
            status,
            laps_completed,
            finish_time_ms,
            stops,
        ) = row

        # A race cached with no results yields one row with the result columns NULL.
        if driver_id is None:
            continue

        drivers.append(
            RaceDriver(
                driver_id=driver_id,
                driver_code=code,
                # Jolpica has no single full-name field; join the two it does have.
                driver_name=f"{given_name} {family_name}".strip(),
                constructor_id=constructor_id,
                constructor_name=constructor_name,
                # grid 0 is a real value (pit-lane start); a NULL grid means upstream
                # recorded none, which reads the same way here.
                grid=grid if grid is not None else 0,
                actual_pit_stops=[
                    # duration_seconds is nullable upstream; 0.0 keeps the float type.
                    PitStop(
                        stop=s["stop"],
                        lap=s["lap"],
                        duration_seconds=_f(s["duration_seconds"]) or 0.0,
                    )
                    for s in (stops or [])
                ],
                actual_finish_position=position,
                actual_position_text=position_text,
                actual_status=status or "",
                actual_laps_completed=laps_completed or 0,
                # null for any driver with no Time object upstream (retirements).
                actual_finish_time_seconds=(
                    None if finish_time_ms is None else finish_time_ms / 1000.0
                ),
            )
        )

    # Derived on ingest from the winner's lap count; recompute if an older row lacks it.
    total_laps = rows[0][6]
    if total_laps is None:
        total_laps = max((d.actual_laps_completed for d in drivers), default=0)

    return RaceDetail(
        season=rows[0][0],
        round=rows[0][1],
        race_name=rows[0][2],
        circuit_id=rows[0][3],
        circuit_name=rows[0][4],
        date=rows[0][5],
        total_laps=total_laps,
        drivers=drivers,
    )


# ---------------------------------------------------------------------------
# GET /api/races/{season}/{round}/drivers/{driver_id}/laps
# ---------------------------------------------------------------------------


def load_driver_laps(
    conn: psycopg.Connection, season: int, round_: int, driver_id: str
) -> list[DriverLap] | None:
    """One driver's recorded laps, in order. None if the driver has no result in this race.

    A driver who took part but has no lap rows (older seasons have no timing data)
    comes back as an empty list, not None - they did race, there's just nothing to plot.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM race_results
            WHERE race_season = %s AND race_round = %s AND driver_id = %s
            """,
            (season, round_, driver_id),
        )
        if cur.fetchone() is None:
            return None

        cur.execute(
            """
            SELECT lap_number, position, lap_time_seconds
            FROM laps
            WHERE race_season = %s AND race_round = %s AND driver_id = %s
            ORDER BY lap_number
            """,
            (season, round_, driver_id),
        )
        rows = cur.fetchall()

    return [
        DriverLap(lap=lap_number, position=position, lap_time_seconds=_f(seconds))
        for lap_number, position, seconds in rows
    ]


# ---------------------------------------------------------------------------
# POST /api/simulate
# ---------------------------------------------------------------------------


class RaceBaseline:
    """Everything the simulation engine reads out of the cache for one race.

    Laps are keyed driver -> lap number so a missing lap is an absent key rather than
    a zero: a rival whose rows stop at lap 30 retired there and drops out of the
    position comparison from lap 31 (simulation-logic.md Step 4).
    """

    def __init__(
        self,
        season: int,
        round_: int,
        circuit_id: str,
        total_laps: int,
        lap_times: dict[str, dict[int, float]],
        lap_positions: dict[str, dict[int, int]],
        pit_laps: dict[str, list[int]],
        pit_durations: list[float],
        laps_completed: dict[str, int],
        finish_time_ms: dict[str, int | None],
        constructors: dict[str, str] | None = None,
        pace_model: RacePaceModel | None = None,
    ) -> None:
        self.season = season
        self.round = round_
        self.circuit_id = circuit_id
        self.total_laps = total_laps
        self.lap_times = lap_times
        self.lap_positions = lap_positions
        self.pit_laps = pit_laps
        self.pit_durations = pit_durations
        self.laps_completed = laps_completed
        self.finish_time_ms = finish_time_ms
        # Constructor is what the tier-2 fallback resolves a team-mate through.
        self.constructors = constructors or {}
        # None means the fit has never been computed for this race, which the engine
        # reads as tier 4 (the generic compound table).
        self.pace_model = pace_model

    def has_driver(self, driver_id: str) -> bool:
        return driver_id in self.laps_completed

    def team_mates(self, driver_id: str) -> list[str]:
        """Other drivers who ran the same constructor's car in this race."""
        constructor = self.constructors.get(driver_id)
        if constructor is None:
            return []
        return sorted(
            other
            for other, other_constructor in self.constructors.items()
            if other != driver_id and other_constructor == constructor
        )


def load_race_baseline(conn: psycopg.Connection, season: int, round_: int) -> RaceBaseline | None:
    """Load the simulation inputs for one race. None if the race isn't cached."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT circuit_id, total_laps FROM races WHERE season = %s AND round = %s",
            (season, round_),
        )
        race = cur.fetchone()
        if race is None:
            return None
        circuit_id, total_laps = race

        cur.execute(
            """
            SELECT driver_id, laps_completed, finish_time_ms, constructor_id
            FROM race_results
            WHERE race_season = %s AND race_round = %s
            """,
            (season, round_),
        )
        laps_completed: dict[str, int] = {}
        finish_time_ms: dict[str, int | None] = {}
        constructors: dict[str, str] = {}
        for driver_id, completed, millis, constructor_id in cur.fetchall():
            laps_completed[driver_id] = completed or 0
            finish_time_ms[driver_id] = millis
            constructors[driver_id] = constructor_id

        cur.execute(
            """
            SELECT driver_id, lap_number, position, lap_time_seconds
            FROM laps
            WHERE race_season = %s AND race_round = %s
            ORDER BY driver_id, lap_number
            """,
            (season, round_),
        )
        lap_times: dict[str, dict[int, float]] = defaultdict(dict)
        lap_positions: dict[str, dict[int, int]] = defaultdict(dict)
        for driver_id, lap_number, position, seconds in cur.fetchall():
            value = _f(seconds)
            if value is not None:
                lap_times[driver_id][lap_number] = value
            if position is not None:
                lap_positions[driver_id][lap_number] = position

        cur.execute(
            """
            SELECT driver_id, lap, duration_seconds
            FROM pit_stops
            WHERE race_season = %s AND race_round = %s
            ORDER BY driver_id, stop
            """,
            (season, round_),
        )
        pit_laps: dict[str, list[int]] = defaultdict(list)
        pit_durations: list[float] = []
        for driver_id, lap, duration in cur.fetchall():
            pit_laps[driver_id].append(lap)
            seconds = _f(duration)
            if seconds is not None:
                pit_durations.append(seconds)

    if total_laps is None:
        total_laps = max(laps_completed.values(), default=0)

    return RaceBaseline(
        season=season,
        round_=round_,
        circuit_id=circuit_id,
        total_laps=total_laps,
        lap_times=dict(lap_times),
        lap_positions=dict(lap_positions),
        pit_laps=dict(pit_laps),
        pit_durations=pit_durations,
        laps_completed=laps_completed,
        finish_time_ms=finish_time_ms,
        constructors=constructors,
        pace_model=load_pace_model(conn, season, round_),
    )


# ---------------------------------------------------------------------------
# Derived pace models (degradation-model.md Step 0)
#
# These are analytics over the cached rows, not cached upstream data, so they live
# behind their own read/write pair and are invalidated by `MODEL_VERSION` rather than
# by re-ingesting the race.
# ---------------------------------------------------------------------------


def load_pace_model(
    conn: psycopg.Connection, season: int, round_: int
) -> RacePaceModel | None:
    """The stored fit for one race, or None if it has never been computed."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT fuel_effect_per_lap, fuel_effect_source, field_median_degradation,
                   max_observed_stint_laps, neutralized_laps, conditions,
                   green_reference_pace_seconds, model_version
            FROM race_pace_models
            WHERE race_season = %s AND race_round = %s
            """,
            (season, round_),
        )
        row = cur.fetchone()
        if row is None:
            return None

        cur.execute(
            """
            SELECT driver_id, stint_number, start_lap, end_lap, laps_used,
                   base_pace_seconds, degradation_per_lap, degradation_stderr,
                   r_squared, max_tire_age, quality
            FROM driver_stint_fits
            WHERE race_season = %s AND race_round = %s
            ORDER BY driver_id, stint_number
            """,
            (season, round_),
        )
        stints = [
            StintFit(
                driver_id=stint[0],
                stint_number=stint[1],
                start_lap=stint[2],
                end_lap=stint[3],
                laps_used=stint[4],
                base_pace_seconds=_f(stint[5]),
                degradation_per_lap=_f(stint[6]),
                degradation_stderr=_f(stint[7]),
                r_squared=_f(stint[8]),
                max_tire_age=stint[9],
                quality=stint[10],
            )
            for stint in cur.fetchall()
        ]

    return RacePaceModel(
        season=season,
        round=round_,
        fuel_effect_per_lap=float(row[0]),
        fuel_effect_source=row[1],
        field_median_degradation=_f(row[2]),
        max_observed_stint_laps=row[3],
        neutralized_laps=list(row[4] or []),
        conditions=row[5],
        green_reference_pace=_f(row[6]),
        model_version=row[7],
        stints=stints,
    )


def store_pace_model(conn: psycopg.Connection, model: RacePaceModel) -> None:
    """Replace the stored fit for one race. Both tables move together, in one transaction."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO race_pace_models (
                race_season, race_round, fuel_effect_per_lap, fuel_effect_source,
                field_median_degradation, max_observed_stint_laps, neutralized_laps,
                conditions, green_reference_pace_seconds, model_version, computed_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
            ON CONFLICT (race_season, race_round) DO UPDATE SET
                fuel_effect_per_lap      = EXCLUDED.fuel_effect_per_lap,
                fuel_effect_source       = EXCLUDED.fuel_effect_source,
                field_median_degradation = EXCLUDED.field_median_degradation,
                max_observed_stint_laps  = EXCLUDED.max_observed_stint_laps,
                neutralized_laps         = EXCLUDED.neutralized_laps,
                conditions               = EXCLUDED.conditions,
                green_reference_pace_seconds = EXCLUDED.green_reference_pace_seconds,
                model_version            = EXCLUDED.model_version,
                computed_at              = now()
            """,
            (
                model.season,
                model.round,
                model.fuel_effect_per_lap,
                model.fuel_effect_source,
                model.field_median_degradation,
                model.max_observed_stint_laps,
                model.neutralized_laps,
                model.conditions,
                model.green_reference_pace,
                model.model_version,
            ),
        )
        # Delete-then-insert rather than upsert: a refit can change how many stints a
        # driver has (a pit stop backfilled by Jolpica), and stale rows would survive
        # an upsert keyed on stint number.
        cur.execute(
            "DELETE FROM driver_stint_fits WHERE race_season = %s AND race_round = %s",
            (model.season, model.round),
        )
        if model.stints:
            cur.executemany(
                """
                INSERT INTO driver_stint_fits (
                    race_season, race_round, driver_id, stint_number, start_lap, end_lap,
                    laps_used, base_pace_seconds, degradation_per_lap, degradation_stderr,
                    r_squared, max_tire_age, quality
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                [
                    (
                        model.season,
                        model.round,
                        stint.driver_id,
                        stint.stint_number,
                        stint.start_lap,
                        stint.end_lap,
                        stint.laps_used,
                        stint.base_pace_seconds,
                        stint.degradation_per_lap,
                        stint.degradation_stderr,
                        stint.r_squared,
                        stint.max_tire_age,
                        stint.quality,
                    )
                    for stint in model.stints
                ],
            )


# How many seasons either side of a race count as the same circuit for pace purposes.
# Cars get faster year on year, so a reference from too far away is measuring the
# regulations rather than the weather. Three seasons is worth a couple of percent, well
# inside the band `WET_PACE_RATIO` leaves for it.
CIRCUIT_REFERENCE_SEASON_WINDOW = 3


def circuit_dry_reference(
    conn: psycopg.Connection, season: int, round_: int
) -> float | None:
    """This circuit's green-flag pace in other cached races that fitted as dry.

    The baseline the weather check needs: a race that was wet from lights to flag is
    unremarkable next to its own median, and only shows up against a race at the same
    circuit that wasn't. None when we have never fitted a dry race here - the check then
    falls back to the within-race regime shift, which is all a first race can offer.

    The median across candidates, so one race mis-fitted as dry cannot set the bar on
    its own once there are a few of them.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT m.green_reference_pace_seconds
            FROM race_pace_models m
            JOIN races r ON r.season = m.race_season AND r.round = m.race_round
            WHERE r.circuit_id = (
                      SELECT circuit_id FROM races WHERE season = %s AND round = %s
                  )
              AND m.conditions = 'dry'
              AND m.green_reference_pace_seconds IS NOT NULL
              AND NOT (m.race_season = %s AND m.race_round = %s)
              AND abs(r.season - %s) <= %s
            """,
            (season, round_, season, round_, season, CIRCUIT_REFERENCE_SEASON_WINDOW),
        )
        values = [float(row[0]) for row in cur.fetchall()]
    return median(values) if values else None


def ensure_pace_model(season: int, round_: int) -> RacePaceModel | None:
    """Fit and store the race's pace model if it is missing or was built by an older version.

    Returns the model in force afterwards, or None if the race isn't cached at all.
    Synchronous like everything else here - call it from a worker thread on request paths.
    """
    with connect() as conn:
        existing = load_pace_model(conn, season, round_)
        if existing is not None and existing.model_version >= MODEL_VERSION:
            return existing

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
