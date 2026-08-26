-- Strategy Room — PostgreSQL schema
-- Cache layer for Jolpica API data. See data-model.md.
--
-- Races are keyed by (season, round), matching Jolpica's own identifier.
-- All child tables reference that composite key.
--
-- Jolpica returns every scalar as a string; casting to integer/numeric/date
-- happens in the ingest layer, not here.

BEGIN;

DROP TABLE IF EXISTS pit_stops;
DROP TABLE IF EXISTS laps;
DROP TABLE IF EXISTS race_results;
DROP TABLE IF EXISTS races;
DROP TABLE IF EXISTS drivers;

-- ---------------------------------------------------------------------------
-- drivers
-- Constructor is a per-race fact (drivers change teams), so it lives on
-- race_results rather than here.
-- ---------------------------------------------------------------------------
CREATE TABLE drivers (
    id                text PRIMARY KEY,          -- Driver.driverId, e.g. 'leclerc'
    given_name        text NOT NULL,             -- Driver.givenName
    family_name       text NOT NULL,             -- Driver.familyName
    code              text,                      -- Driver.code, e.g. 'LEC'; older seasons lack it
    permanent_number  integer,                   -- Driver.permanentNumber; nullable
    nationality       text
);

-- ---------------------------------------------------------------------------
-- races
-- ---------------------------------------------------------------------------
CREATE TABLE races (
    season       integer NOT NULL,               -- RaceTable.season
    round        integer NOT NULL,               -- RaceTable.round
    race_name    text    NOT NULL,               -- raceName
    circuit_id   text    NOT NULL,               -- Circuit.circuitId, e.g. 'monza'
    circuit_name text    NOT NULL,               -- Circuit.circuitName
    date         date    NOT NULL,
    total_laps   integer,                        -- derived: winner's Results[].laps
    PRIMARY KEY (season, round)
);

-- ---------------------------------------------------------------------------
-- race_results — final classification per driver, from /results.json
--
-- Time.time is deliberately not stored: it's a total for the winner but a gap
-- for everyone else. Time.millis is the only consistent total.
-- ---------------------------------------------------------------------------
CREATE TABLE race_results (
    id               serial PRIMARY KEY,
    race_season      integer NOT NULL,
    race_round       integer NOT NULL,
    driver_id        text    NOT NULL REFERENCES drivers (id),
    constructor_id   text    NOT NULL,           -- Constructor.constructorId, e.g. 'ferrari'
    constructor_name text    NOT NULL,           -- Constructor.name
    grid             integer,                    -- 0 means pit lane start
    position         integer NOT NULL,           -- always numeric, even for retirements
    position_text    text    NOT NULL,           -- '1', 'R', 'D'… the real classification
    points           numeric,
    laps_completed   integer,
    status           text,                       -- 'Finished', '+1 Lap', 'Retired'…
    finish_time_ms   bigint,                     -- Time.millis; NULL for retirements
    FOREIGN KEY (race_season, race_round) REFERENCES races (season, round),
    UNIQUE (race_season, race_round, driver_id)
);

-- ---------------------------------------------------------------------------
-- laps — actual lap-by-lap data per driver per race, from /laps.json
-- Basis for the "actual" side of every comparison.
-- ---------------------------------------------------------------------------
CREATE TABLE laps (
    id               serial PRIMARY KEY,
    race_season      integer NOT NULL,
    race_round       integer NOT NULL,
    driver_id        text    NOT NULL REFERENCES drivers (id),
    lap_number       integer NOT NULL,           -- Laps[].number
    position         integer,                    -- track position at end of lap
    lap_time_seconds numeric,                    -- '1:27.623' parsed to 87.623
    FOREIGN KEY (race_season, race_round) REFERENCES races (season, round),
    UNIQUE (race_season, race_round, driver_id, lap_number)
);

-- ---------------------------------------------------------------------------
-- pit_stops — actual pit stops from /pitstops.json
--
-- duration_seconds is the whole pit-lane pass (entry -> exit), not the 2-3s
-- wheel-gun time; directly comparable to simulation-logic.md Step 2's penalty.
-- No compound_in column: Jolpica exposes no tire compound data anywhere.
-- ---------------------------------------------------------------------------
CREATE TABLE pit_stops (
    id               serial PRIMARY KEY,
    race_season      integer NOT NULL,
    race_round       integer NOT NULL,
    driver_id        text    NOT NULL REFERENCES drivers (id),
    stop             integer NOT NULL,           -- 1-indexed per driver
    lap              integer NOT NULL,
    duration_seconds numeric,
    time_of_day      time,                       -- local clock time, not elapsed
    FOREIGN KEY (race_season, race_round) REFERENCES races (season, round),
    UNIQUE (race_season, race_round, driver_id, stop)
);

-- ---------------------------------------------------------------------------
-- Lookup indexes for the read paths the API actually uses.
-- The UNIQUE constraints above already cover (race_season, race_round, ...)
-- prefix lookups, so these only add the driver-centric access patterns.
-- ---------------------------------------------------------------------------
CREATE INDEX idx_race_results_driver ON race_results (driver_id);
CREATE INDEX idx_laps_driver         ON laps (driver_id);
CREATE INDEX idx_pit_stops_driver    ON pit_stops (driver_id);

COMMIT;
