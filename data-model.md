# Data Model (PostgreSQL)

Cache layer for Jolpica API data — populated lazily on first request per race, not re-fetched every time.

Races are keyed by **`(season, round)`**, matching Jolpica's own identifier
(`/ergast/f1/{season}/{round}/...`). No composite string id.

Jolpica returns every scalar as a string; all casting to `integer` / `numeric` / `date`
happens in the ingest layer, not in the DB.

## `drivers`
| Column | Type | Notes |
|---|---|---|
| id | text (PK) | `Driver.driverId`, e.g. `leclerc` |
| given_name | text | `Driver.givenName` |
| family_name | text | `Driver.familyName` — Jolpica has no single full-name field |
| code | text | `Driver.code`, e.g. `LEC`. Nullable — older seasons lack it |
| permanent_number | integer | `Driver.permanentNumber`. Nullable |
| nationality | text | `Driver.nationality` |

Constructor is a per-race fact, not a driver fact (drivers change teams), so it lives on
`race_results` rather than here.

## `races`
| Column | Type | Notes |
|---|---|---|
| season | integer | PK part 1 — `RaceTable.season` |
| round | integer | PK part 2 — `RaceTable.round` |
| race_name | text | `raceName` |
| circuit_id | text | `Circuit.circuitId`, e.g. `monza` |
| circuit_name | text | `Circuit.circuitName`, e.g. `Autodromo Nazionale di Monza` |
| date | date | `date` |
| total_laps | integer | **Derived** — Jolpica has no such field. Winner's `Results[].laps` |

`PRIMARY KEY (season, round)`

## `race_results`
Final classification per driver, from `/results.json`.

| Column | Type | Notes |
|---|---|---|
| id | serial (PK) | |
| race_season | integer | FK → races.season |
| race_round | integer | FK → races.round |
| driver_id | text | FK → drivers.id |
| constructor_id | text | `Constructor.constructorId`, e.g. `ferrari` |
| constructor_name | text | `Constructor.name` |
| grid | integer | `grid` — 0 means pit lane start |
| position | integer | `position` — always numeric, even for retirements |
| position_text | text | `positionText` — `"1"`, `"R"`, `"D"`… the real classification |
| points | numeric | `points` |
| laps_completed | integer | `laps` |
| status | text | `status`, e.g. `Finished`, `Lapped`, `Retired` |
| finish_time_ms | bigint | `Time.millis`. **Nullable** — `Time` is absent for retirements |

`FOREIGN KEY (race_season, race_round) REFERENCES races (season, round)`
`UNIQUE (race_season, race_round, driver_id)`

`Time.time` is deliberately not stored: it's the total time for the winner but a gap
(`"+22.820"`) for everyone else. `Time.millis` is the only consistent total.

## `laps`
Actual lap-by-lap data per driver per race, from `/laps.json`. Basis for the "actual" side
of every comparison.

It is now also the basis for the **modeled** side. `race_pace_models` and
`driver_stint_fits` are derived from these rows — the driver's own lap times are what the
tire degradation magnitude is measured from (`degradation-model.md`). This inverts an
assumption stated in a few places in the older docs, that the modeled side comes purely
from chosen parameters and the recorded side purely from Jolpica. The modeled side is now
*fitted to* the recorded side; only the compound labels remain pure model.

| Column | Type | Notes |
|---|---|---|
| id | serial (PK) | |
| race_season | integer | FK → races.season |
| race_round | integer | FK → races.round |
| driver_id | text | FK → drivers.id — `Timings[].driverId` |
| lap_number | integer | `Laps[].number` |
| position | integer | `Timings[].position` — track position at end of lap |
| lap_time_seconds | numeric | Parsed from `Timings[].time` (`"1:27.623"` → `87.623`) |

`FOREIGN KEY (race_season, race_round) REFERENCES races (season, round)`
`UNIQUE (race_season, race_round, driver_id, lap_number)`

**Ingest must paginate.** `/laps.json` pages by individual driver timing, not by lap —
the 2024 Italian GP is `total: 1008` at a default `limit: 30`. Walk `?limit=N&offset=M`
until `offset + limit >= total`, or you cache two laps and think you're done.

## `pit_stops`
Actual pit stops that happened in the real race, from `/pitstops.json`.

| Column | Type | Notes |
|---|---|---|
| id | serial (PK) | |
| race_season | integer | FK → races.season |
| race_round | integer | FK → races.round |
| driver_id | text | FK → drivers.id — `PitStops[].driverId` |
| stop | integer | `stop` — 1-indexed per driver |
| lap | integer | `lap` — lap the stop happened on |
| duration_seconds | numeric | `duration`, e.g. `"24.335"`. Total pit-lane loss, **not** stationary time |
| time_of_day | time | `time`, e.g. `"15:10:58"` — local clock time, not elapsed |

`FOREIGN KEY (race_season, race_round) REFERENCES races (season, round)`
`UNIQUE (race_season, race_round, driver_id, stop)`

`duration` is the whole pit-lane pass (entry → exit), not the 2–3s wheel-gun time — Monza
2024 clean stops run ~22–25s. `simulation-logic.md` Step 2's 20–25s penalty is the same
quantity, so the two are directly comparable.

**No `compound_in` column.** Jolpica exposes no tire compound data on any endpoint —
not results, pit stops, or laps. Compound exists only as user input to
`POST /api/simulate` and is never persisted.

---

# Derived analytics

The two tables below are **not** a Jolpica cache. They are computed from the cached rows
above and can be thrown away and rebuilt at any time, which is why they are versioned
separately (`model_version`) rather than invalidated by re-ingesting a race. Full
derivation in `degradation-model.md`.

## `race_pace_models`
One row per race.

| Column | Type | Notes |
|---|---|---|
| race_season | integer | PK part 1, FK → races.season |
| race_round | integer | PK part 2, FK → races.round |
| fuel_effect_per_lap | numeric | Pooled across the whole field, clamped to [0.02, 0.12] |
| fuel_effect_source | text | `fitted` \| `clamped` \| `default` |
| field_median_degradation | numeric | Tier-3 fallback. Nullable — no race-wide fit succeeded |
| max_observed_stint_laps | integer | `A_race`: longest tire age any driver reached. Anchors the extrapolation |
| neutralized_laps | integer[] | Laps detected as safety car / VSC. Empty array, never NULL |
| conditions | text | `dry` \| `mixed`. **`mixed` means the race is refused, not downgraded** |
| green_reference_pace_seconds | numeric | This race's green-flag pace. What *other* races at the same circuit are checked against when deciding whether they were wet. Nullable — too few green laps to take one |
| model_version | integer | Bump to invalidate every cached fit |
| computed_at | timestamptz | |

`PRIMARY KEY (race_season, race_round)`
`FOREIGN KEY (race_season, race_round) REFERENCES races (season, round)`

## `driver_stint_fits`
One row per driver per stint. Kept per stint rather than collapsed per driver so a
surprising degradation number can be traced back to the stint that produced it.

| Column | Type | Notes |
|---|---|---|
| id | serial (PK) | |
| race_season | integer | FK → races.season |
| race_round | integer | FK → races.round |
| driver_id | text | FK → drivers.id |
| stint_number | integer | 1-indexed; stint *n* follows stop *n−1* |
| start_lap | integer | |
| end_lap | integer | |
| laps_used | integer | After filtering — **not** `end_lap − start_lap` |
| base_pace_seconds | numeric | Fitted lap time at tire age 0 on `start_lap`. Nullable |
| degradation_per_lap | numeric | The number the whole exercise exists to produce. Nullable |
| degradation_stderr | numeric | Feeds the Monte Carlo resampling. Nullable |
| r_squared | numeric | Of the pooled model within this stint; 0.0 means no explanatory power |
| max_tire_age | integer | `end_lap − start_lap`; contributes to `A_driver` |
| quality | text | `good` (≥8 laps) \| `sparse` (≥5) \| `unreliable` |

`FOREIGN KEY (race_season, race_round) REFERENCES races (season, round)`
`UNIQUE (race_season, race_round, driver_id, stint_number)`

An `unreliable` row has NULL coefficients. It is still written, so "why is this driver on
tier 2?" has an answer in the table rather than only in the code.

**Still no `compound_in` column anywhere.** Nothing here changes that — the fit derives a
falloff magnitude, never a compound label.

## Notes
- Simulation results (hypothetical strategies) are **not** stored — computed on demand by
  `POST /api/simulate` and returned directly. Nothing to persist there for v1.
- Pace models are computed **after ingest completes** for a race — all three Jolpica
  fetches must have landed, because the fuel coefficient is pooled across the whole field
  and needs every driver's laps. `POST /api/simulate` also derives one lazily if the race
  was cached before this model existed.
- A pace model is recomputed when its stored `model_version` is older than the code's.
  Re-ingesting a race does not by itself invalidate the fit; changing the fit does.
- `backend/migrations/001_pace_model_tables.sql` adds these two tables to a database that
  already holds cached races. `schema.sql` creates them from scratch but drops the cache
  on the way.
- `laps`, `pit_stops` and `race_results` populate lazily: the first
  `GET /api/races/{season}/{round}` call for an uncached race triggers three Jolpica
  fetches (`/results`, `/pitstops`, `/laps`) + insert.
- Jolpica returns HTTP 200 with an empty `Races` array for a season/round that doesn't
  exist. Treat empty as not-found; don't cache an empty race row.
