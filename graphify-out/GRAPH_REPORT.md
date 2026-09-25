# Graph Report - strategy room  (2026-09-25)

## Corpus Check
- 62 files · ~53,597 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 6 file(s) not represented in the graph (top: (none) 4, .example 1, .css 1)

## Summary
- 581 nodes · 1260 edges · 25 communities (22 shown, 3 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 55 edges (avg confidence: 0.92)
- Token cost: 166,004 input · 0 output

## Community Hubs (Navigation)
- Live Landing Scenes
- Mock Landing Scenes
- API Contract & Docs
- Jolpica Client & Config
- Pace Model Fitting
- Frontend Dependencies
- Race Repository Queries
- Degradation & Stint Model
- Race Ingest Writer
- Story Backdrop Art
- DB Pool & App Entrypoint
- Pace Model Storage
- API Schemas
- Simulation Results Assembly
- Race Cache & Simulate Route
- Race Baseline Types
- Simulate Request Flow
- Ingest CLI
- Per-Driver Pace Model
- Monte Carlo Run Sampling
- Lint Config
- Strategy Validation
- Race Not Found Error
- Vite Scaffold Docs
- Favicon Branding

## God Nodes (most connected - your core abstractions)
1. `compute_pace_model()` - 22 edges
2. `RaceBaseline` - 20 edges
3. `connect()` - 19 edges
4. `run_simulation()` - 18 edges
5. `RacePaceModel` - 15 edges
6. `ensure_pace_model()` - 15 edges
7. `RaceNotFoundError` - 12 edges
8. `react` - 12 edges
9. `fetch_results()` - 11 edges
10. `fetch_pit_stops()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `Strategy Room Project Overview (what-if machine)` --semantically_similar_to--> `Strategy Room (F1 pit-strategy what-if app)`  [INFERRED] [semantically similar]
  Strategy_Room_Project_Overview.pdf → CLAUDE.md
- `ScrollStory Landing Flow (5 scenes)` --semantically_similar_to--> `Screen 1: Race Selector`  [INFERRED] [semantically similar]
  CLAUDE.md → frontend-plan.md
- `Strategy Room Project Overview (what-if machine)` --references--> `Jolpica API (Ergast successor)`  [EXTRACTED]
  Strategy_Room_Project_Overview.pdf → CLAUDE.md
- `fastapi[standard] 0.141.1` --conceptually_related_to--> `POST /api/simulate`  [INFERRED]
  backend/requirements.txt → api-contract.md
- `Screen 3: Simulation Results` --conceptually_related_to--> `pace_model Response Block`  [AMBIGUOUS]
  frontend-plan.md → api-contract.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Step 0 Pace-Model Derivation Pipeline (Steps A-E)** — degradation_model_stint_segmentation, degradation_model_green_flag_filter, degradation_model_pooled_fuel_coefficient, degradation_model_quality_gate, degradation_model_fallback_tiers, simulation_logic_step0_pace_model [EXTRACTED 1.00]
- **Lazily Populated Jolpica Cache Tables** — data_model_drivers_table, data_model_races_table, data_model_race_results_table, data_model_laps_table, data_model_pit_stops_table, data_model_lazy_cache_population [EXTRACTED 1.00]
- **Monte Carlo Run-to-Run Variance Sources** — simulation_logic_pit_stop_penalty, simulation_logic_safety_car_randomness, degradation_model_degradation_resampling, simulation_logic_monte_carlo [EXTRACTED 1.00]

## Communities (25 total, 3 thin omitted)

### Community 0 - "Live Landing Scenes"
Cohesion: 0.06
Nodes (71): ActualStrategyScene(), ChangeStrategyScene(), percentOf(), LapPaceChart(), lapTicks(), paceDomain(), paceTicks(), PaceTooltip() (+63 more)

### Community 1 - "Mock Landing Scenes"
Cohesion: 0.07
Nodes (53): CircuitBackdrop(), ActualStrategyScene(), FASTEST_LAP, STINTS, ACTUAL_STINTS, ChangeStrategyScene(), MIN_PIT_LAP, percentOf() (+45 more)

### Community 2 - "API Contract & Docs"
Cohesion: 0.06
Nodes (54): GET /api/races/{season}/{round}/drivers/{driver_id}/laps, GET /api/races/{season}/{round}, GET /api/races, Laps Endpoint Pagination by Driver Timing, pace_model Response Block, POST /api/simulate, 409 unsupported_conditions Response, Jolpica Upstream Field Mapping (+46 more)

### Community 3 - "Jolpica Client & Config"
Cohesion: 0.08
Nodes (48): Any, jolpica_base(), Environment-backed settings. Reads the project-root .env (one level above…, Driver, fetch_laps(), fetch_pit_stops(), fetch_race_bundle(), fetch_race_info() (+40 more)

### Community 4 - "Pace Model Fitting"
Cohesion: 0.07
Nodes (48): _chol_solve(), _cholesky(), _clean_window(), compute_pace_model(), _fallback(), _consecutive_runs(), _detect_conditions(), _detect_neutralized_laps() (+40 more)

### Community 5 - "Frontend Dependencies"
Cohesion: 0.06
Nodes (35): dependencies, framer-motion, react, react-dom, recharts, tailwindcss, @tailwindcss/vite, devDependencies (+27 more)

### Community 6 - "Race Repository Queries"
Cohesion: 0.11
Nodes (31): asyncio, _f(), list_race_summaries(), load_driver_laps(), load_race_detail(), Read queries against the Postgres cache. Every function here assumes the race…, Assemble the GET /api/races/{season}/{round} payload. None if the race isn't…, One driver's recorded laps, in order. None if the driver has no result in this… (+23 more)

### Community 7 - "Degradation & Stint Model"
Cohesion: 0.14
Nodes (21): (start_lap, end_lap) per stint, 1-indexed and inclusive. A stop on lap L…, segment_stints(), _build_pace_model(), Degradation, _degradation_floor(), _driver_degradation(), _field_stderr(), _floored() (+13 more)

### Community 8 - "Race Ingest Writer"
Cohesion: 0.19
Nodes (19): missing_tables(), Which of the cache tables don't exist yet - i.e. schema.sql hasn't been run., cache_race(), _write(), _count_stored(), IngestReport, Connection, Fetch a race from Jolpica and cache it in Postgres. One race is one… (+11 more)

### Community 9 - "Story Backdrop Art"
Cohesion: 0.15
Nodes (16): CarDot(), DRAW_OFFSETS, DRAW_POINTS, DRAW_SPRING, DrawnLine(), Glow(), paddedViewBox(), rgba() (+8 more)

### Community 10 - "DB Pool & App Entrypoint"
Cohesion: 0.14
Nodes (16): database_url(), close_pool(), pool(), Postgres connection helpers. Deliberately synchronous. The ingest path is a…, The process-wide connection pool, opened on first use., Shut the pool down. Called from the FastAPI lifespan; a no-op if never opened., health(), lifespan() (+8 more)

### Community 11 - "Pace Model Storage"
Cohesion: 0.22
Nodes (17): circuit_dry_reference(), ensure_pace_model(), load_pace_model(), load_race_baseline(), Connection, Load the simulation inputs for one race. None if the race isn't cached., The stored fit for one race, or None if it has never been computed., Replace the stored fit for one race. Both tables move together, in one… (+9 more)

### Community 12 - "API Schemas"
Cohesion: 0.17
Nodes (15): LapComparison, PaceModelInfo, PitStop, RaceDriver, Pydantic models mirroring the response shapes in api-contract.md. Field names…, Where the degradation number came from, so the frontend can caveat honestly. A…, 409 body when a race can't be simulated at all. Documented in api-contract.md., An actual pit stop. Carries no compound — Jolpica doesn't publish tire data. (+7 more)

### Community 13 - "Simulation Results Assembly"
Cohesion: 0.18
Nodes (13): _actual_position(), _lap_by_lap(), _median_run(), RuntimeError, The *race* can't be simulated - wet/mixed conditions. Surfaces as a 409.…, Sorted rival cumulative race times per lap, for the position lookup. A rival is…, Run `request.num_simulations` iterations and aggregate them. Raises…, The representative run for the chart - the one with the median total time. (+5 more)

### Community 14 - "Race Cache & Simulate Route"
Cohesion: 0.21
Nodes (11): connect(), Connection, Check out a pooled connection, committing on clean exit and rolling back on…, ensure_cached(), race_is_cached(), Is this race in the cache? A `races` row is a sufficient marker: `cache_race`…, Cache the race if it isn't already. Raises `RaceNotFoundError` if it doesn't…, _load_baseline() (+3 more)

### Community 15 - "Race Baseline Types"
Cohesion: 0.22
Nodes (6): RacePaceModel, One race's derived pace model. Mirrors a `race_pace_models` row plus its stints., A `mixed` race is refused rather than modeled - see api-contract.md., RaceBaseline, Everything the simulation engine reads out of the cache for one race. Laps are…, Other drivers who ran the same constructor's car in this race.

### Community 16 - "Simulate Request Flow"
Cohesion: 0.28
Nodes (9): The synchronous half: validation plus the Monte Carlo., Run the Monte Carlo simulation for a hypothetical strategy against the baseline., _run(), simulate(), POST /api/simulate response., POST /api/simulate request body., SimulationRequest, SimulationResponse (+1 more)

### Community 17 - "Ingest CLI"
Cohesion: 0.33
Nodes (6): argparse, ingest_race(), Fetch one race from Jolpica and cache it. Raises `RaceNotFoundError` if absent., main(), Fetch one race from Jolpica and cache it in Postgres. cd backend…, sys

### Community 18 - "Per-Driver Pace Model"
Cohesion: 0.33
Nodes (4): PaceModel, Lap time as a function of lap number, tire age and compound. `lap_time =…, Step F: the derived magnitude, scaled by the compound's ratio, then floored.…, How much the slope is resampled by, widening outside the observed range.

### Community 19 - "Monte Carlo Run Sampling"
Cohesion: 0.38
Nodes (7): Total pit-lane loss for one stop (entry, stop, exit) - not wheel-gun time.…, Whether a safety car happens this run, and on which lap. Weighted toward mid-…, One end-to-end run of steps 1-5., _sample_pit_loss(), _sample_safety_car_lap(), _simulate_once(), Random

### Community 20 - "Lint Config"
Cohesion: 0.33
Nodes (5): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema

### Community 21 - "Strategy Validation"
Cohesion: 0.40
Nodes (5): InvalidStrategyError, Contract's 400 cases: pit lap outside race length, unknown compound., The request can't be simulated. Surfaces as a 400., validate_strategy(), ValueError

## Ambiguous Edges - Review These
- `pace_model Response Block` → `Screen 3: Simulation Results`  [AMBIGUOUS]
  frontend-plan.md · relation: conceptually_related_to

## Knowledge Gaps
- **57 isolated node(s):** `$schema`, `plugins`, `react/rules-of-hooks`, `react/only-export-components`, `name` (+52 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 192 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `pace_model Response Block` and `Screen 3: Simulation Results`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `react` connect `Frontend Dependencies` to `Live Landing Scenes`, `Mock Landing Scenes`, `Story Backdrop Art`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `RaceBaseline` connect `Race Baseline Types` to `Race Repository Queries`, `Degradation & Stint Model`, `Pace Model Storage`, `Simulation Results Assembly`, `Race Cache & Simulate Route`, `Simulate Request Flow`, `Monte Carlo Run Sampling`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Why does `connect()` connect `Race Cache & Simulate Route` to `Race Ingest Writer`, `DB Pool & App Entrypoint`, `Pace Model Storage`, `Race Repository Queries`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Are the 10 inferred relationships involving `RaceBaseline` (e.g. with `RacePaceModel` and `_actual_position()`) actually correct?**
  _`RaceBaseline` has 10 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `run_simulation()` (e.g. with `RaceBaseline` and `SimulationRequest`) actually correct?**
  _`run_simulation()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 6 inferred relationships involving `RacePaceModel` (e.g. with `ensure_pace_model()` and `RaceBaseline`) actually correct?**
  _`RacePaceModel` has 6 INFERRED edges - model-reasoned connections that need verification._