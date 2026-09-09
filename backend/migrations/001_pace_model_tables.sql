-- Adds the two derived-analytics tables from degradation-model.md to a database that
-- already holds cached races. schema.sql creates the same tables from scratch, but it
-- drops the cache on the way, and re-ingesting is a few hundred Jolpica requests.
--
-- Idempotent: safe to run against a database that already has them.
--
--     psql "$DATABASE_URL" -f backend/migrations/001_pace_model_tables.sql

BEGIN;

CREATE TABLE IF NOT EXISTS race_pace_models (
    race_season             integer   NOT NULL,
    race_round              integer   NOT NULL,
    fuel_effect_per_lap     numeric   NOT NULL,
    fuel_effect_source      text      NOT NULL,
    field_median_degradation numeric,
    max_observed_stint_laps integer   NOT NULL,
    neutralized_laps        integer[] NOT NULL DEFAULT '{}',
    conditions              text      NOT NULL,
    model_version           integer   NOT NULL,
    computed_at             timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (race_season, race_round),
    FOREIGN KEY (race_season, race_round) REFERENCES races (season, round)
);

CREATE TABLE IF NOT EXISTS driver_stint_fits (
    id                  serial PRIMARY KEY,
    race_season         integer NOT NULL,
    race_round          integer NOT NULL,
    driver_id           text    NOT NULL REFERENCES drivers (id),
    stint_number        integer NOT NULL,
    start_lap           integer NOT NULL,
    end_lap             integer NOT NULL,
    laps_used           integer NOT NULL,
    base_pace_seconds   numeric,
    degradation_per_lap numeric,
    degradation_stderr  numeric,
    r_squared           numeric,
    max_tire_age        integer NOT NULL,
    quality             text    NOT NULL,
    FOREIGN KEY (race_season, race_round) REFERENCES races (season, round),
    UNIQUE (race_season, race_round, driver_id, stint_number)
);

CREATE INDEX IF NOT EXISTS idx_stint_fits_driver ON driver_stint_fits (driver_id);

COMMIT;
