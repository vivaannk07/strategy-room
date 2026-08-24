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
| status | text | `status`, e.g. `Finished`, `+1 Lap`, `Retired` |
| finish_time_ms | bigint | `Time.millis`. **Nullable** — `Time` is absent for retirements |

`FOREIGN KEY (race_season, race_round) REFERENCES races (season, round)`
`UNIQUE (race_season, race_round, driver_id)`

`Time.time` is deliberately not stored: it's the total time for the winner but a gap
(`"+22.820"`) for everyone else. `Time.millis` is the only consistent total.

## `laps`
Actual lap-by-lap data per driver per race, from `/laps.json`. Basis for the "actual" side
of every comparison.

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

## Notes
- Simulation results (hypothetical strategies) are **not** stored — computed on demand by
  `POST /api/simulate` and returned directly. Nothing to persist there for v1.
- `laps`, `pit_stops` and `race_results` populate lazily: the first
  `GET /api/races/{season}/{round}` call for an uncached race triggers three Jolpica
  fetches (`/results`, `/pitstops`, `/laps`) + insert.
- Jolpica returns HTTP 200 with an empty `Races` array for a season/round that doesn't
  exist. Treat empty as not-found; don't cache an empty race row.
