# Simulation Logic

Plain-language notes on how the "what if" engine works — written before any code so Claude Code implements this reasoning instead of inventing its own.

## Goal
Given a real past race and a hypothetical pit strategy for one driver (different lap(s) and/or tire compound(s) than what actually happened), compute what that driver's finishing time and position would likely have been — as a range of outcomes, not a single number, because real races have randomness (safety cars) a single deterministic run can't capture.

## Inputs
- Real race's lap-by-lap data (baseline, from `laps` table — `lap_time_seconds`, `position`)
- Real pit stops (baseline, from `pit_stops` table — `lap`, `stop`, `duration_seconds`)
- Real classification (from `race_results` — `finish_time_ms`, `position`, `status`),
  for the delta in Step 6
- A race is identified by `season` + `round`, not a composite id string
- Hypothetical strategy: list of `{ lap, compound_in }` for the one driver being changed
- Everyone else keeps their **actual** strategy — only one driver's strategy is hypothetical per simulation

### The compound asymmetry — read this before implementing Step 1
**Jolpica publishes no tire compound data**, so we do not know which compound any driver
was actually on during any real stint. The consequence runs through the whole engine:

- Compound is known **only** for the hypothetical strategy, because the user picked it.
- The baseline side has **no compound model at all**. Its lap times are the real recorded
  `lap_time_seconds` values, used as-is.

So this is not a like-for-like comparison of two modeled strategies. It is a modeled
strategy compared against recorded reality. Do not try to infer real stint compounds from
pit lap spacing or lap-time trends — that's a guess dressed as data, and it would make the
baseline worse than just using the times that actually happened.

## Step 1 — Tire degradation model
Each compound has a lap-time falloff curve: lap time increases roughly linearly with laps on that set (good enough for v1). Starting deltas, tune later against real data:
- Soft: fastest when fresh, degrades fastest (~+0.08s/lap)
- Medium: middle pace, middle degradation (~+0.05s/lap)
- Hard: slowest when fresh, degrades slowest (~+0.03s/lap)

Lap time = `base_lap_time_for_compound + (degradation_rate * laps_on_current_set)`.

`base_lap_time_for_compound` is a **model parameter, not upstream data** — derive it from
the driver's own real pace (e.g. their median green-flag lap time for the race) plus a
per-compound offset we choose and tune. It cannot be looked up per real stint, because
real stint compounds are unknown. Applies to the hypothetical driver's changed stints only.

## Step 2 — Pit stop penalty
Every pit stop costs a fixed time penalty of **20–25 seconds** — randomize within this range per simulation run (don't hardcode one value; this is one source of run-to-run variance). Applied as a one-time addition on the lap the stop happens.

This penalty models **total pit-lane loss** (entry, stop, exit), which is the same quantity
Jolpica's `PitStops[].duration` measures — Monza 2024 values run ~22–25s for a clean stop
(`gasly` 24.335), with outliers for problem stops (`hulkenberg` 38.875). It is **not** the
2–3s stationary/wheel-gun time. Don't mix the two scales.

Optional refinement: instead of a flat 20–25s, sample from the actual `duration_seconds`
values recorded for that race, which bakes in circuit-specific pit-lane length for free.

## Step 3 — Recompute only what changes
Don't resimulate the whole race from scratch. Laps before the first strategy change are identical to baseline. From the first changed lap onward, recompute lap times using Step 1 + Step 2 for the hypothetical driver only.

## Step 4 — Track position / traffic (undercut-overcut)
This is what makes it a strategy simulator rather than a lap-time calculator:
- Pitting **earlier** than the real strategy = potential undercut — if the hypothetical driver rejoins ahead of a rival who hasn't pitted yet, they can hold that position once the rival does pit.
- Pitting **later** = potential overcut — staying out longer can gain track position if others pit into traffic.
- Resolve without full physics: compare the hypothetical driver's cumulative race time at each lap against every other driver's actual cumulative time at that lap. Lower cumulative time = ahead on track. This produces the lap-by-lap position series used in the Compare view.
- Rivals who retired or were lapped drop out of the comparison partway through — their
  `laps` rows simply end. Use `race_results.laps_completed` / `status` to know a rival is
  gone rather than treating a missing lap as an infinitely slow one, or positions will
  drift upward for free late in the race.

## Step 5 — Safety car randomness
Each circuit has a historical safety-car probability, keyed by `races.circuit_id` (e.g.
`monza`) — hardcode per-circuit values if available, otherwise a flat ~30% default for v1.
Per simulation run:
- Randomly decide if a safety car occurs, and on which lap (weighted toward mid-race).
- If it falls at or after the hypothetical driver's pit lap, discount the pit-stop penalty from Step 2 by roughly 15–18s for that run (a stop taken under safety car costs much less relative to the field).
- This is the main reason a single run isn't representative — whether a safety car interacts favorably or unfavorably with a chosen pit lap is luck, which is exactly what real strategists plan around.

## Step 6 — Monte Carlo
Run Steps 1–5 end to end **~500 times** per request, re-rolling safety car randomness each time. Collect:
- Mean and median total race time
- Distribution of finishing positions (count of runs per finishing position)
- Delta vs. the actual real-race result — baseline is `race_results.finish_time_ms / 1000`

Return the aggregate stats plus one representative lap-by-lap position series (median run) for the Compare view chart — don't chart all 500 runs.

If the selected driver retired, `finish_time_ms` is `null` and there is no time delta to
compute. Either reject the request (400) or return the position distribution with a null
delta — decide once and make the frontend match.

## Explicitly out of scope for v1
- Multi-driver hypothetical changes in the same simulation
- Weather changes
- Driver skill/pace variance beyond what's in the real lap data
- Full wheel-to-wheel overtaking physics — position swaps are inferred from cumulative time only
- Real stint compounds — unavailable from Jolpica. Adding them means a second data source
  (FastF1 publishes them); until then the baseline stays "recorded lap times", not a
  compound model