# Simulation Logic

Plain-language notes on how the "what if" engine works — written before any code so Claude Code implements this reasoning instead of inventing its own.

## Goal
Given a real past race and a hypothetical pit strategy for one driver (different lap(s) and/or tire compound(s) than what actually happened), compute what that driver's finishing time and position would likely have been — as a range of outcomes, not a single number, because real races have randomness (safety cars) a single deterministic run can't capture.

## Inputs
- Real race's lap-by-lap data (baseline, from `laps` table — `lap_time_seconds`, `position`)
- Real pit stops (baseline, from `pit_stops` table — `lap`, `stop`, `duration_seconds`)
- Real classification (from `race_results` — `finish_time_ms`, `position`, `status`),
  for the delta in Step 6
- The race's derived pace model (`race_pace_models`, `driver_stint_fits`) — computed from
  the `laps` table by Step 0 and cached, not fetched
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
baseline worse than just using the times that actually happened. **That prohibition still
stands in full.**

What *has* changed (see `degradation-model.md`) is the other half of the old claim. We
used to say we do not know how a given car degraded either, and price every stint from a
fixed per-compound table. We now **measure the magnitude of degradation** from the
driver's own recorded lap times, per race, in Step 0. So:

- **Magnitude** — how fast this car's lap time fell away per lap of tire age — is derived
  from data, and differs per driver, per race.
- **Compound** — which rubber produced that falloff — is still never asserted. The
  compound the user picks only scales the derived magnitude by a ratio (Step 1).

Deriving a slope is not inferring a compound. The two are independent, and only the second
one is forbidden.

## Step 0 — Derive the race's pace model
Runs **once per race**, after all three Jolpica fetches have landed, and is cached in
`race_pace_models` / `driver_stint_fits`. Not per request. Full derivation in
`degradation-model.md`; the shape of it:

1. **Segment stints** from `pit_stops.lap`. A stop on lap L is driven on the old set, so
   L+1 starts the new one.
2. **Filter to green-flag tire pace** — drop lap 1, in-laps, out-laps, laps neutralized by
   a safety car or VSC (detected from the *field median* lap time, since Jolpica has no
   track-status data), and slow one-sided residual outliers (traffic).
3. **Detect conditions at race level.** Two checks: a sustained regime shift in this
   race's field median that isn't a neutralization (a race that *changed* conditions),
   and this race's green pace against the same circuit's pace in other cached races that
   fitted dry (a race that was wet from lights to flag, which has no shift to find).
   Either one flags the race `conditions = 'mixed'`, and such a race is **not simulated
   at all** — see Step 7. Keeping a safety car out of these checks is a *best effort*,
   not a guarantee: a neutralization is told apart from rain by whether the field stays
   bunched (a safety car queues the cars; rain scatters them), which separates every
   case in the cached races but is a threshold on a noisy measurement, so it can be
   wrong in both directions — unusually uniform rain can be filtered away as a
   neutralization and the race then served as dry, and a block whose spread can't be
   measured is left in and may read as weather. See `degradation-model.md` Step B for
   what is measured, where the threshold sits, and what it still misses.
4. **Fit** every driver's stints jointly, pooled across the whole field, to
   `lap_time = base_pace − fuel_effect × lap + degradation × tire_age`. One shared
   fuel coefficient per race, one intercept per driver, one slope per driver-stint.
   Fitting a stint on its own cannot work: within a stint, tire age and lap number differ
   by a constant, so a per-stint slope measures `degradation − fuel_effect` and
   understates degradation by roughly 0.05 s/lap. The pit stop is what separates them.
5. **Gate on quality** — a stint needs 8 usable laps to be `good`, 5 to be `sparse`,
   below that it is `unreliable` and falls through. A driver's degradation is the
   `laps_used`-weighted mean of their fitted stints.

A driver's degradation is then floored at
`max(driver_degradation, 0.5 × field_median_degradation, 0.020)`, at every tier. A fitted
slope near zero is an artefact of the one-sided outlier trim, not a car that doesn't wear
its tires, and taken literally it makes an unsurvivable stint look free. The response
carries `pace_model.degradation_floored` when the floor is what answered.

The floor is applied **again in Step 1, after the compound ratio**, against the effective
per-lap falloff. Applying it only to the medium-equivalent magnitude and then scaling that
by the compound left the bound 40% weaker on a hard tire and 60% stronger on a soft one,
so the thing meant to stop an unsurvivable stint coming out free went missing on exactly
the compound long stints are run on. A floor is a claim about lap time, and it does not
get weaker because the rubber is harder.

The fit also records `max_observed_stint_laps` (the longest tire age *anyone* reached in
the race, which anchors Step 1's extrapolation), `neutralized_laps`, and
`green_reference_pace_seconds` (what other races at this circuit are checked against).

### Fallback tiers
First hit wins, and **which tier answered is returned in the API response** — a tier-4
answer and a tier-1 answer deserve very different confidence in the UI.

| Tier | Source | Catches |
|---|---|---|
| 1 | This driver, this race | The real answer |
| 2 | Their constructor's other car, this race | Driver retired on lap 4, or ran one stint |
| 3 | Field median for this race | At minimum, the circuit and the day's conditions |
| 4 | Generic compound table | Uncached race, or total fit failure |

`conditions = 'mixed'` does **not** fall to tier 4. The race is refused outright (Step 7).

## Step 1 — Tire degradation model
Lap time for the hypothetical driver's changed stints:

```
lap_time = base_pace
         − fuel_effect × lap                       (Step 0, pooled per race)
         + compound_offset                         (fresh-tire pace delta, below)
         + derived_degradation × multiplier[compound] × tire_age
         + excess penalty past the observed envelope
```

**Compound is a multiplier now, not a table lookup.** The derived slope is
compound-agnostic — it measures how this car degraded on whatever it was running — but
the user still picks a compound the driver may never have used, so compound has to keep
meaning something. The magnitude comes from data; the ratio comes from the old table,
normalized to medium = 1.0: soft ×1.6, medium ×1.0, hard ×0.6, intermediate ×1.2,
wet ×0.8. Medium is the model's zero point, and the assumed compound for the opening
stint, which the user never picks.

The **fresh-tire pace offsets stay absolute** (soft −0.30s, medium 0.00, hard +0.40,
intermediate +2.00, wet +5.00) — they're a pace delta, not a falloff, and nothing in the
lap data isolates them. So the old table isn't deleted: its ratios drive tiers 1–3 and
its absolute values are still the tier-4 fallback.

`base_pace` is still a **model parameter, not upstream data** — but it is now a *fitted*
one: the driver's own intercept from the Step 0 solve, i.e. their lap time at tire age 0
with a full fuel load, rather than their median lap time. That removes the old centring
hack (measuring degradation against the driver's mean actual tire age), which existed only
because a median lap time already has real degradation baked into it. Centring
systematically favoured whatever compound the driver actually ran; the fitted intercept
doesn't.

### Extrapolating past the real stint length
Real degradation is convex, so a straight line prices a 40-lap stint as merely mildly
slow — the "unsurvivable stint looks fast" bug. Two envelopes, from this race's data:

| Range | Model | Rationale |
|---|---|---|
| `age ≤ A_driver` | Fitted line, nominal stderr | Directly observed |
| `A_driver < age ≤ A_race` | Fitted line, stderr × 1.5 | Someone ran a set this long here today |
| `age > A_race` | Fitted line + `κ × excess²`, stderr growing per lap | Beyond anything observed |

`A_driver` is the longest tire age this driver reached; `A_race` the longest any driver
reached. Past `A_race`, `excess = age − A_race` and
`κ = 0.35 × field_median_degradation` — scaled off the field, not off this car, and
**not** put through the compound ratio. Scaling it off the car meant a slope near zero
bought a cliff near zero, so the one case the term exists for came out free for exactly
the cars the fit flattered most; scaling it per compound was the same mistake in the other
axis, discounting the extrapolation 40% on hards. The cliff belongs to the tire and the
circuit, which the whole field shares; how fast a car walks toward it is the linear term's
job.

The excess term is a backstop, not the main defence. It only acts past `A_race`, so at a
circuit where somebody did run a long stint — Monza 2024, `A_race = 41` — a 47-lap
hypothetical leaves it just 5 laps to work with and it contributes about a second. The
floor above is what does the work there.

Absurd strategies are **not** rejected — exploring a stupid strategy and watching it be
stupid is the point of the app. The response carries `pace_model.beyond_evidence` so the
frontend can caveat the chart, and the widening distribution does the rest.

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

The two sides now agree much more closely at the boundary lap than they used to, because
the modeled side starts from the driver's own fitted pace rather than a median plus a
generic curve. The seam at `first_changed_lap` should be far less visible on the chart.
It won't vanish: the modeled side is green-flag pace by construction, while the recorded
side contains the traffic and neutralizations that actually happened, so a long modeled
tail still reads slightly optimistic.

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

Step 0 now records `neutralized_laps` — which laps of *this* race were actually run behind
a safety car or VSC. That's better raw material for tuning the hardcoded per-circuit
probabilities than the guesses they started as, once enough races are cached.

## Step 6 — Monte Carlo
Run Steps 1–5 end to end **~500 times** per request, re-rolling safety car randomness each time. Collect:
- Mean and median total race time
- Distribution of finishing positions (count of runs per finishing position)
- Delta vs. the actual real-race result — baseline is `race_results.finish_time_ms / 1000`

There are now **three** sources of run-to-run variance, not two. Alongside the safety car
and the pit-loss sample, each run resamples `degradation` from
`Normal(derived, stderr)`, with `stderr` inflated per the Step 1 envelope and the sample
clamped at zero (tires never get faster with age). This is what buys the model its
honesty: a stint inside the observed range returns a tight distribution, while a wild
extrapolation returns one that visibly spans several positions, so the chart communicates
"we don't know" instead of asserting a confident fantasy.

Return the aggregate stats, one representative lap-by-lap position series (median run) for
the Compare view chart — don't chart all 500 runs — and the `pace_model` block (tier,
derived degradation, `beyond_evidence`) so the frontend can caveat the result honestly.

If the selected driver retired, `finish_time_ms` is `null` and there is no time delta to
compute. Either reject the request (400) or return the position distribution with a null
delta — decide once and make the frontend match.

## Step 7 — Refuse what can't be modeled
If Step 0 flagged the race `conditions = 'mixed'`, the simulation does not run at all. It
returns **409** with a structured body (`api-contract.md`) rather than falling back to the
generic compound table.

Falling back would return a plausible-looking number for a race where the tire model has
no purchase, and a confident wrong answer is worse than a refusal the frontend can explain.
This is a *race*-level refusal, not a strategy-level one: nothing the user picked is
invalid, so it is deliberately not a 400.

## Explicitly out of scope for v1
- Multi-driver hypothetical changes in the same simulation
- Weather. Detected at race level (Step 0) and refused (Step 7); never modeled
- Full wheel-to-wheel overtaking physics — position swaps are inferred from cumulative time only
- Real stint compounds — unavailable from Jolpica. Adding them means a second data source
  (FastF1 publishes them); until then the baseline stays "recorded lap times", not a
  compound model
- Cross-race or season-long degradation priors. More stable, but they would erase exactly
  the race-to-race variation the derived model exists to capture
- Quadratic degradation *inside* the observed range — most stints don't have the laps for it

**No longer out of scope:** per-driver pace and degradation variance. That used to read
"driver skill/pace variance beyond what's in the real lap data", and it is now explicitly
*in* the model — measured per driver, per race, from the real lap data (Step 0).