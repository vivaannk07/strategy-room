-- Adds `race_pace_models.green_reference_pace_seconds` - the race's own green-flag
-- pace, which is what other races at the same circuit are compared against when
-- deciding whether a race was wet (degradation-model.md, Step B).
--
-- Idempotent: safe to run against a database that already has the column.
--
--     psql "$DATABASE_URL" -f backend/migrations/002_green_reference_pace.sql
--
-- The column is NULL on every existing row. It fills in as each race is refitted, which
-- MODEL_VERSION = 2 forces; `scripts/fit_pace_model.py --all` does the whole cache at
-- once, and does it twice, because a race can only borrow a reference from a neighbour
-- that has already been refitted.

BEGIN;

ALTER TABLE race_pace_models
    ADD COLUMN IF NOT EXISTS green_reference_pace_seconds numeric;

COMMIT;
