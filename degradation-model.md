# Data-Driven Tire Degradation Model

**Status: implemented.** Built in `backend/app/pace_model.py` (Steps A–E) and
`backend/app/simulation.py` (Steps F–H); tables in `backend/schema.sql` and
`backend/migrations/001_pace_model_tables.sql`. `simulation-logic.md`,
`data-model.md` and `api-contract.md` have been updated to match, and are the
authority for how the shipped system behaves — this document is the reasoning behind
it, kept for the derivation and the list of known errors.

**The three open questions at the bottom are resolved**; their answers are folded into
the text below. One thing in the design as originally written was wrong and had to
change — the per-stint intercept in Step C, see the note there.

## The problem with the current model

Today Step 1 prices every hypothetical stint from a fixed table
(`COMPOUND_MODEL` in `backend/app/simulation.py`): soft `+0.080 s/lap`, medium
`+0.050`, hard `+0.030`. Two consequences we've confirmed in use:

1. **Every car degrades identically.** A Ferrari and a Sauber on the same compound
   get the same falloff, at every circuit, in every race. We know from watching that
   this is the single biggest thing the model gets wrong — the whole point of a strategy
   sim is that Mercedes eats its rears at one track and McLaren doesn't, and next race
   it flips.
2. **Long stints look free.** The model is linear forever, so a 40-lap stint on softs
   is priced at `0.08 × 40 = 3.2 s/lap` at the end — bad, but survivable-looking, and
   the pit-stop it avoids costs 20–25s. So the sim recommends stints that would
   physically not last, which is the "unsurvivable stint looks faster" bug.

The `laps` table already contains the answer to (1): the driver's real lap times, from
which the car's real falloff can be measured. This document proposes measuring it.

## What we can and can't know — restated

`simulation-logic.md` is right that we must not infer real stint *compounds* from pit
spacing. That constraint is untouched here. This design derives **how fast this car's
lap time fell away, per stint, in this race** — a magnitude, not a compound label. We
never assert what rubber was on the car.

That distinction matters for what the derived number *means*, and it's the largest known
error in the design. See "Known systematic errors" below.

---

## The core idea

For each driver in each race, fit their recorded lap times to a model that separates
the two things moving lap time in opposite directions:

```
lap_time(L) = base_pace
            + fuel_effect × L                 (gets FASTER through the race)
            + degradation  × tire_age(L)      (gets SLOWER through a stint)
```

`tire_age` resets to 0 at every pit stop; `L` (absolute lap number) never resets. Fit
once per race, cache the coefficients, and use them in place of the compound table.

### Why the reset is the whole trick

**Within a single stint, fuel burn and tire age are perfectly collinear** — age is just
`L − stint_start_lap`, so a regression on one stint cannot tell them apart. A naive
per-stint slope of lap time vs. tire age measures `degradation − fuel_effect`, and
systematically *understates* degradation by roughly 0.05 s/lap.

The pit stop is what makes the two separable: age drops to zero while lap number
carries on. So the fit has to span **all of a driver's stints jointly**, not one at a
time. This is the single most important implementation detail in this doc — a
per-stint-in-isolation fit is subtly, consistently wrong, and it'll look fine.

---

## Step A — Segment stints

Derivable from data we already cache; nothing new is fetched.

- Stint boundaries come from `pit_stops.lap` for that driver, ordered by `stop`.
- Stint 1 is laps `1 … pit_lap[1]`; stint *n* is `pit_lap[n-1]+1 … pit_lap[n]`; the
  final stint runs to `race_results.laps_completed`.
- A stop on lap L happens *during* L, so L is driven on the old set and L+1 is the
  first lap of the new one. (`_tire_age_by_lap` already encodes this convention —
  keep it.)
- Drivers with zero pit stops (rare, usually a lap-1 retirement) produce one stint and
  are not identifiable; they fall to the tiers in Step E.

## Step B — Filter to green-flag tire pace

We want laps where the only thing making the car slower is the tires. Drop, in order:

| Drop | Why |
|---|---|
| Lap 1 | Standing start, turn-1 chaos — not a lap time |
| The in-lap (`pit_stops.lap`) | Includes the pit-lane entry |
| The out-lap (`pit_stops.lap + 1`) | Cold tires, pit-lane exit — not representative of age-0 pace |
| Field-neutralized laps | Safety car / VSC — see below |
| Slow per-driver residual outliers | Traffic — see below |

**Safety car and VSC, without a flag from Jolpica.** Jolpica exposes no track-status
data, but a neutralization is a *field-wide* event, so it's visible in the data we
have. For each lap, take the **median lap time across all drivers still running**. A
lap whose field median exceeds `1.15 ×` the rolling field-median baseline is
neutralized. Mark it, and mark the following lap too (restart laps are also
unrepresentative). This is far more reliable than per-driver detection, which can't
tell a safety car from one driver having a bad lap.

Store the detected lap numbers — Step 5 of the sim (safety-car randomness) currently
guesses circuit probability from a hardcoded table, and knowing which laps were
actually neutralized in *this* race is worth having recorded regardless.

**Traffic.** Traffic can only ever make a lap slower, never faster, so trim one-sided:
fit, compute residuals, drop laps whose residual is more than `+1.0 s` above the
fitted line, refit once. Do not trim fast outliers — those are real pace. One refit
pass is enough for v1; iterating to convergence invites over-trimming a genuinely
degrading stint into a flat one.

**Weather.** Detect at race level, don't model. Two checks, because they catch different
races; either one flags the race `conditions = 'mixed'`, and we then **do not derive
degradation from it**.

1. **Within-race regime shift.** A block of ≥5 laps more than 10% off the race median
   that isn't explained by a detected neutralization. This catches a race that *changes*
   conditions, and it is all we have on a circuit we have only seen once.
2. **Against the circuit's own dry pace.** Take this race's green-flag pace as one number
   — the 25th percentile of the non-neutralized field medians, i.e. the race at its
   quickest — and compare it against the same number from other cached races at this
   circuit that fitted as `dry`, within ±3 seasons, median across them. More than 10%
   slower and the race was not run in the dry. Wet pace is 15–40% off; two dry races at
   the same circuit in different seasons are a couple of percent apart, so the band
   absorbs regulation changes and a resurface without swallowing rain.

Check 2 is what closes the gap check 1 left open. A race that is wet from lights to flag
has no regime change to find — it sets its own race median and reads as perfectly normal
against itself, while its derived degradation comes out 2.5× the same race run dry. It is
only visible from outside the race.

The reference is stored per race as `race_pace_models.green_reference_pace_seconds`, and
is recorded even for a race we refuse (a refused race just never *serves* as a reference,
since only `dry` rows are eligible).

**Resolving open question 3:** such a race does *not* fall through to the generic curve —
the whole race is refused, and `POST /api/simulate` returns 409 with
`code: "unsupported_conditions"` (see `api-contract.md`). Falling back would return a
number that looks exactly as confident as a real one for a race where the model has no
purchase. Refusing lets the frontend say something true.

Two details the implementation had to add:

- **Telling a long neutralization from weather.** The first cut used length alone: a run
  longer than 8 laps was un-flagged and handed to the weather check. That was wrong about
  the world — a multi-car incident with barrier repairs, or a safety car that absorbs a
  red-flag restart, runs well past eight racing laps — and every such race was being
  refused as rain on a dry day. Raising the threshold to 15 was the wrong repair: it
  simply moved the error, because a genuine 9–15 lap rain spell was then filtered away as
  a neutralization and the race served as confidently dry, which is worse than refusing
  it. The threshold is back at **8**, and length is now only ever a *sufficient*
  condition, never the thing that separates the two cases.

  What separates them is **how far apart the field is**. Under a safety car every car is
  limited by the one in front, so the field's lap times stay as tightly grouped as they
  are under green. Rain does the opposite — grip, tire choice and wet-weather confidence
  differ per driver, and the field comes apart. Take each lap's interquartile spread of
  lap times as a fraction of its median (dropping in- and out-laps, or a lap where half
  the field is in the pit lane looks scattered for the wrong reason), and compare a
  block's median spread against the race's own green spread. Measured on the cached races:

  | Block | Spread ÷ that race's green spread |
  |---|---|
  | Silverstone 2023, laps 33–38 (safety car) | 1.06× |
  | Zandvoort 2023, laps 60–67 (wet finish) | 2.5× |
  | Zandvoort 2023, laps 2–11 (wet start) | 3.2× |
  | Zandvoort 2023, laps 17–21 (wet) | 3.7× |

  The threshold is **1.6×**, roughly the geometric middle of that gap. A block above it is
  handed to the weather check whatever its length; a block below it and longer than 8 laps
  still has to show the field's pace coming back (below) before it is filtered away.
- **Does the field's pace come back?** Asked only of a block too long to settle on length.
  A safety car ends and the cars return to the pace they had; rain moves the baseline, so
  the laps after a wet block stay slow. Compare the 5 clean laps either side of the block;
  within 8% is a neutralization. A block against either **end** of the race has only one
  side. Calling that undecidable was a bug, not caution — a safety car on lap 1, or one
  still out at the flag, was handed to the weather check every time and duly turned a dry
  race into rain. The one side it does have is now compared against the race's own green
  baseline (the median of every unflagged lap), which asks the same question: is the
  racing either side of this block the pace this race runs at generally? That comparison
  is the weaker of the two, since the green baseline overlaps the window it is checked
  against — it is only reached for a block the spread test has already recognised as
  safety-car shaped, and that is what carries the discrimination.
- The rolling baseline is computed in **two passes** — a global median flags the obvious
  blocks, then the baseline is recomputed over the laps that survived — so a long
  neutralization cannot drag its own local baseline up and hide inside it.

**What this still gets wrong.** It is no longer true that a safety car can never be
mistaken for weather, and it never was. The weather checks themselves are hard to trip
with a slow block — both read only the laps that survived neutralization, and check 2
takes a low quantile of them — but that is only as good as the neutralization detection
feeding them, and that detection is a threshold on a noisy measurement. Both directions
fail:

- **Rain read as a safety car** (a dry answer for a wet race, the worse failure). Rain
  that slows every car by about the same amount keeps the field grouped and reads as a
  neutralization. Synthetically, detection holds down to about 1.7× green spread and is
  lost below it; every wet block measured in a real cached race is 2.5× or more, so there
  is margin, but it is a margin and not a proof.
- **A safety car read as rain** (a refusal for a race that could have been simulated).
  A block past 8 laps whose spread cannot be measured — too few cars left running, or too
  few laps — is deliberately *not* filtered away, because a race wrongly refused is
  recoverable and a wet race answered as if it were dry is not.

Fixing this properly needs track-status data, which Jolpica does not publish.

Known limitation: check 2 needs a prior dry race at the same circuit. The **first** race
cached at a circuit still has only check 1, so a lights-to-flag wet race there reads as
`dry`. `api-contract.md` says so in the 409 section, and the frontend should not pretend
otherwise.

## Step C — Estimate the fuel coefficient, pooled per race

Fuel effect is a property of the race (lap length, fuel load), not of the driver, and
every car burns at broadly the same rate. So estimate it **once per race, pooled
across all drivers**, using one ordinary least-squares fit whose design matrix has:

- one shared `fuel_effect` coefficient on absolute lap number,
- a separate intercept **per driver**,
- a separate degradation slope per driver-stint.

> **Correction, found during implementation.** This originally said "a separate intercept
> per driver-*stint*". That design matrix is exactly rank deficient and `fuel_effect` is
> not identified by it. Within a stint, `lap = tire_age + start_lap`, so for any candidate
> fuel coefficient `f` you can set `intercept' = intercept − f × start_lap` and
> `slope' = slope − f` and reproduce the fit exactly. Every stint having its own free
> intercept *and* its own free slope leaves the fuel column in the span of the other two.
>
> Sharing one intercept across a driver's stints is what breaks the tie, and it is also
> the precise statement of "the pit stop is what makes the two separable": it asserts that
> the car's fresh-tire pace is the same all race apart from fuel burned, so the drop in
> fresh-tire pace from one stint to the next *is* the fuel effect. Fitted values come out
> where physics says they should — 0.059 at Monza, 0.085 at Spa, 0.051 at Melbourne —
> which is the check that this is measuring fuel and not absorbing something else.
>
> The cost is an assumption: a driver whose stint compounds genuinely differed in fresh
> pace has that difference misread as fuel. Pooling ~20 drivers averages it out.

Pooling gives the fuel term ~20 drivers × ~50 laps of evidence instead of one driver's
handful of stints, which is what makes it stable. This is a single OLS solve of a few
hundred rows — ~130 ms in pure Python, computed once and cached.

**Sanity clamp.** Physical fuel effect is roughly 0.03 s/kg × ~1.8 kg/lap ≈ **0.05
s/lap**, ranging ~0.03 (short lap) to ~0.09 (Spa, Monza). Clamp the fitted value to
`[0.02, 0.12]`; outside that band the fit is telling us something is wrong with the
race, not about fuel. On a degenerate or clamped fit, fall back to a flat `0.055`.

Note the sign convention: `fuel_effect` is a positive number describing how much time
the car *gains* per lap as fuel burns off, so it enters the lap-time model negatively.

## Step D — Fit per-driver, per-stint degradation

From the same solve, each driver-stint yields:

| Output | Use |
|---|---|
| `base_pace` | Fitted lap time at tire age 0, normalized to a reference lap. Replaces the `reference_age` centering hack in the current `PaceModel`. |
| `degradation` | The per-lap falloff we actually wanted. |
| `stderr` | Standard error of the slope — feeds Monte Carlo (Step G). |
| `r_squared`, `laps_used` | Quality gate. |

**Quality gate.** A stint needs `laps_used ≥ 8` to be `good`, `≥ 5` to be `sparse`
(usable, but with inflated `stderr`), and below that is `unreliable` — discard and fall
through. Also discard fits with a *negative* degradation beyond noise (`< −0.02`): a
car genuinely getting faster on old tires means the fit caught a drying track or a
fuel-effect misattribution, not tire behaviour.

These thresholds are guesses. They should be validated against a couple of cached
races before the numbers are treated as settled.

**Which of a driver's stints do we use?** Take the `laps_used`-weighted mean of their
`good` stints as the driver's degradation for that race. Keeping per-stint rows in the
table anyway is cheap and makes the fit auditable when a result looks wrong.

## Step E — Fallback tiers

Precedence chain, first hit wins:

| Tier | Source | Catches |
|---|---|---|
| 1 | This driver, this race | The real answer |
| 2 | Their constructor's other car, this race | Driver retired on lap 4, or ran one stint |
| 3 | Field median for this race | At minimum, the circuit and the day's conditions |
| 4 | Generic `COMPOUND_MODEL` table | Uncached race, total fit failure |

**Resolving open question 1: tier 2 is in.** A driver who retires early has almost no
data, but their team-mate ran the same car on the same track, which is a much better
estimate than a generic curve. It cost about fifteen lines. Whichever tier was used is
reported in the API response — a tier-4 answer and a tier-1 answer deserve very different
confidence in the UI.

`conditions = 'mixed'` is deliberately **not** in the tier-4 row: that race is refused,
not downgraded (Step B, and open question 3).

Two implementation choices inside the chain:

- A driver with only `sparse` stints still answers tier 1, with `stderr` inflated ×1.5,
  rather than dropping a tier for the sake of three missing laps. `sparse` is defined as
  "usable, but with inflated stderr", so this is what that definition means in practice.
  Only `unreliable` falls through.
- When a team has two eligible cars, tier 2 takes the estimate with the smaller standard
  error rather than an average — the better-evidenced team-mate, not a blend.

## Step F — Compound becomes a multiplier, not a table

**This is the answer to "does it replace the compound model?": neither fully. The
compound table is retained, demoted from an absolute degradation source to a relative
one.**

The derived slope is compound-agnostic — it measures how this car degraded on whatever
it was running. But the user still picks a compound the driver may never have used, so
compound has to keep meaning something. Split the two roles:

- **Magnitude** comes from data: the derived `degradation` for that driver/race.
- **Ratio** comes from the existing table, normalized to medium = 1.0:

  | Compound | Current absolute | Multiplier |
  |---|---|---|
  | Soft | 0.080 | 1.6 |
  | Medium | 0.050 | 1.0 |
  | Hard | 0.030 | 0.6 |
  | Intermediate | 0.060 | 1.2 |
  | Wet | 0.040 | 0.8 |

  `effective_degradation = derived_degradation × multiplier[compound]`

The fresh-tire pace offsets (soft `−0.30`, hard `+0.40`) stay as absolute values —
they're a pace delta, not a falloff, and nothing in the lap data isolates them.

So `COMPOUND_MODEL` keeps both jobs: its ratios drive tier 1–3, and its absolute values
remain the tier-4 fallback. Nothing is deleted.

## Step G — Extrapolating past the real stint length

The scenario: real Leclerc pitted on lap 15, the user asks for lap 30. We have a slope
fitted over tire ages 0–14 and are being asked about age 29.

Straight-line extrapolation is exactly the bug we're fixing — real degradation is
convex, and the linear model prices a 30-lap stint as merely mildly slow. So define
two envelopes from the race data, and get progressively more punitive past them:

| Range | Model | Rationale |
|---|---|---|
| `age ≤ A_driver` | Fitted line, nominal `stderr` | Directly observed |
| `A_driver < age ≤ A_race` | Fitted line, `stderr × 1.5` | *Someone* ran a set this long here today, so it's survivable — but not by this car, as far as we know |
| `age > A_race` | Fitted line **+ quadratic excess term**, `stderr` growing with excess | Beyond anything observed in this race |

- `A_driver` = the longest tire age this driver reached in this race.
- `A_race` = the longest tire age **any** driver reached in this race. This is the
  better credibility anchor: if a Haas ran 40 laps on one set at Monza, 40 laps is a
  thing that was possible at Monza that day.

**The excess term.** Past `A_race`:

```
lap_time_penalty = degradation × excess + κ × excess²
where excess = age − A_race,  κ = 0.35 × field_median_degradation
```

The design first specified `κ = 0.15 × driver_degradation`, on the reasoning that a car
gentle on tires should fall off the cliff later and less steeply than one that isn't.
Both halves of that turned out to be wrong in practice:

- **κ now scales off the field median, not the driver.** Scaling it off the driver was
  self-defeating: a car the fit flattered at 0.004 s/lap got an extrapolation penalty of
  roughly zero, so the one case the term exists for came out free for exactly the cars
  whose slope we trust least. Norris at Monza 2024 was priced at 9 s *faster* over a
  47-lap stint than his real two-stop race. The cliff belongs to the tire and the
  circuit, which the whole field shares; how fast a car walks toward it is what the
  linear term is for. (Floored at the driver's own value, so a car dirtier than the field
  doesn't fall off the cliff more gently than the field does.)
- **κ is 0.35, not 0.15.** 0.15 was a guess and it was too soft to deter anything at
  realistic excesses.

*As built,* κ scales off the field's **raw** median degradation, with no compound
multiplier on it. It was briefly compound-adjusted (`field median × multiplier[compound]`)
on the reasoning that a soft tire should fall off the cliff harder than a hard one — but
that contradicts the paragraph above it. If the cliff belongs to the tire and the circuit,
which the whole field shares, then routing it through the *hypothetical* compound is the
same mistake as routing it through the driver, one axis over: it discounted the
extrapolation 40% on hards, which is the compound a stint long enough to need this term
would actually be run on. The stderr inflation past `A_race` — left unspecified here as
"growing with excess" — is `1.5 + 0.1 × excess`.

Worked example, `field_median_degradation = 0.06 s/lap`, `A_race = 30`, asked for age 50
(`excess = 20`):

- linear part: `0.06 × 20 = 1.2 s/lap`
- quadratic part: `0.35 × 0.06 × 400 = 8.4 s/lap`
- total: **~9.6 s/lap slower** than at age 30 — enough that no amount of saved pit stops
  makes the strategy attractive, which is the correct answer.

At `excess = 10` it's `0.6 + 2.1 = 2.7 s/lap`: a real deterrent, not a wall. The shape
is deliberately smooth rather than a hard cliff at a fixed lap, because placing a cliff
requires knowing the compound, and we don't.

**The floor on the derived degradation.** κ scaling off the field is only half the fix.
The linear term still runs off the driver's own slope, and a slope near zero is a
measurement artefact rather than a car that doesn't wear its tires — one-sided outlier
trimming shaves the slow end off a stint, and a driver managing pace leaves no falloff to
measure. So whatever Step E returns is floored at

```
max(driver_degradation, 0.5 × field_median_degradation, 0.020)
```

Half the field median because a car really can be gentler on its tires than the field,
just not by an order of magnitude; the absolute minimum for a race where the whole field
fitted flat. The floor applies at **every** tier — a near-zero answer is no more
believable for having been measured off a team-mate — and the Monte Carlo resampling is
held at the same floor, so the low tail can't undo it. When the floor is what answered,
the response says so (`pace_model.degradation_floored`): the number is then a lower bound
on the car's tire wear, not a measurement of it.

**Where the floor is applied.** It has to bind **after** the Step F compound ratio, not
only before it. Flooring the medium-equivalent magnitude and then multiplying by the
compound left the bound scaled with it — 0.6× of itself on a hard tire, 1.6× on a soft —
so the one thing standing between an unsurvivable stint and a free lunch was 40% weaker on
exactly the compound such a stint would be run on. The symptom: at Monza 2024, the
47-lap hypothetical for Norris, Hamilton and Russell came out correctly slower than their
real races on softs while hards and mediums still beat reality, and no amount of tuning κ
fixed it, because with `A_race = 41` the excess term has only 5 laps to act on and
contributes about a second. So:

```
effective_degradation = max(derived × multiplier[compound], floor)
```

`max` only ever raises, so a slope that already clears the floor on its own compound is
untouched; only the physically implausible case binds. A floor is a claim about lap time,
and it does not get weaker because the rubber is harder.

**Do we reject absurd strategies outright?** No. Considered returning 400 past
`1.3 × A_race`, and rejected it: exploring a stupid strategy and watching it be stupid
is the point of the app. Instead flag the response (`beyond_evidence: true`) so the
frontend can caveat the chart, and let the penalty and the widening distribution do the
talking.

## Step H — Feed the uncertainty into Monte Carlo

Right now the only run-to-run variance is the safety car and the pit-loss sample, so
500 runs of a confident-but-wrong pace model produce a tight distribution around a
wrong number. Add a third source: **resample `degradation` per run** from
`Normal(fitted, stderr)`, with `stderr` inflated per the Step G envelope.

This gets us the honesty for free. A stint inside the observed range returns a tight
distribution; a wild extrapolation returns a wide one that visibly spans several
positions. The chart then communicates "we don't know" instead of asserting a
confident fantasy.

Also: **apply the fuel term in the forward simulation**, which it currently doesn't do
at all. Once `fuel_effect` is fitted it costs nothing, and without it a hypothetical
stint late in the race is priced with the same base pace as one at the start.

---

## Tradeoffs and known systematic errors

**We don't know the reference compound.** The derived slope is anchored to "whatever
this driver actually ran," but Step F treats it as the medium-tire baseline. A driver
who spent the race on hards gets a low derived slope, and asking for softs multiplies
a too-low number by 1.6. This is the largest systematic error in the design and it is
not fixable from Jolpica — it needs FastF1's compound data, which
`simulation-logic.md` already names as the eventual second source. Accept it in v1,
document it in the UI, and note that it biases *comparisons between compounds* far more
than it biases *comparisons between drivers*, which is the use case we're actually
fixing.

**One race is a small sample.** A driver who spent a stint stuck behind a slower car
gets a flattered slope even after outlier trimming. Mitigated by the quality gate and
by reporting the tier, not eliminated. Pooling degradation across a season would be
more stable but would erase the race-to-race variation that motivated this whole change.

**Linear inside the observed range.** Real degradation is mildly convex throughout, not
just past the envelope, so mid-range long stints stay slightly optimistic. Acceptable
for v1 — the fix (fitting a quadratic per stint) needs more laps per stint than most
stints have.

**Pooled fuel assumes uniform burn.** Cars run different fuel strategies and
lift-and-coast patterns. The error is small relative to the noise we're already
accepting.

**Compute cost is negligible.** One OLS per race, cached in Postgres, invalidated by a
`model_version` bump. No per-request fitting.

---

## Changes to `data-model.md`

Two new tables. Both are **derived analytics, not Jolpica cache** — worth keeping
separate from the cache tables so they can be recomputed and versioned without
touching ingested data.

### `race_pace_models` — one row per race

| Column | Type | Notes |
|---|---|---|
| race_season | integer | PK part 1, FK → races.season |
| race_round | integer | PK part 2, FK → races.round |
| fuel_effect_per_lap | numeric | Pooled Step C estimate, clamped to [0.02, 0.12] |
| fuel_effect_source | text | `fitted` \| `clamped` \| `default` |
| field_median_degradation | numeric | Tier-3 fallback |
| max_observed_stint_laps | integer | `A_race` — the Step G credibility anchor |
| neutralized_laps | integer[] | Lap numbers detected as SC/VSC in Step B |
| conditions | text | `dry` \| `mixed` — `mixed` is refused (409), not downgraded |
| green_reference_pace_seconds | numeric | This race's green-flag pace. What *other* races at this circuit are checked against in Step B |
| model_version | integer | Bump to invalidate every cached fit |
| computed_at | timestamptz | |

`PRIMARY KEY (race_season, race_round)`

### `driver_stint_fits` — one row per driver per stint

| Column | Type | Notes |
|---|---|---|
| id | serial (PK) | |
| race_season | integer | FK → races.season |
| race_round | integer | FK → races.round |
| driver_id | text | FK → drivers.id |
| stint_number | integer | 1-indexed; stint *n* follows stop *n−1* |
| start_lap | integer | |
| end_lap | integer | |
| laps_used | integer | After Step B filtering — not `end_lap − start_lap` |
| base_pace_seconds | numeric | Fitted lap time at tire age 0 |
| degradation_per_lap | numeric | The number this whole doc exists to produce |
| degradation_stderr | numeric | Feeds Monte Carlo resampling (Step H) |
| r_squared | numeric | |
| max_tire_age | integer | Contributes to `A_driver` |
| quality | text | `good` \| `sparse` \| `unreliable` |

`FOREIGN KEY (race_season, race_round) REFERENCES races (season, round)`
`UNIQUE (race_season, race_round, driver_id, stint_number)`

### Also update in `data-model.md`

- The **Notes** section: add that pace models are computed after ingest completes for a
  race (all three Jolpica fetches must have landed), and are recomputed when
  `model_version` changes.
- The `laps` table description currently says it's "the basis for the 'actual' side of
  every comparison." It's now also the basis for the *modeled* side. Worth a sentence,
  since that inverts an assumption stated in three places.
- No changes to `drivers`, `races`, `race_results`, `pit_stops`. Still no
  `compound_in` column anywhere — nothing here changes that.

## Changes to `simulation-logic.md`

- **"The compound asymmetry" section** — needs the biggest rewrite. Its claim that
  "the baseline side has no compound model at all" stays true, but "we do not know how
  this car degraded" becomes false: we now measure it. Reframe as: *we derive the
  magnitude of degradation from lap times; we still never assert which compound
  produced it.* Explicitly keep the existing prohibition on inferring compounds from
  pit spacing — this design does not violate it.
- **New Step 0 — Derive the pace model.** Steps A–E above. Runs once per race after
  ingest, cached; not per request.
- **Step 1 — Tire degradation model** — replaced. New formula:
  `lap_time = base_pace − fuel_effect × lap + derived_deg × multiplier[compound] × tire_age`,
  plus the Step G extrapolation rules. Keep the paragraph explaining that
  `base_lap_time_for_compound` is a model parameter — it's now a *fitted* parameter,
  which is a strictly better version of the same statement.
- **Step 2 — Pit stop penalty** — unchanged.
- **Step 3 — Recompute only what changes** — unchanged in principle. Worth a note that
  the modeled and actual sides now agree much more closely at the boundary lap, so the
  seam at `first_changed_lap` should be much less visible than it is today.
- **Step 4 — Track position** — unchanged.
- **Step 5 — Safety car** — unchanged, but note that `neutralized_laps` now records what
  actually happened in each race, which is better raw material for tuning
  `SAFETY_CAR_PROBABILITY` than the hardcoded circuit table.
- **Step 6 — Monte Carlo** — add degradation resampling as a third variance source
  (Step H), and add the confidence/tier fields to what's collected and returned.
- **"Explicitly out of scope"** — "Driver skill/pace variance beyond what's in the real
  lap data" needs rewording: per-driver pace variance is now explicitly *in* the model.
  Weather and real stint compounds stay out of scope.

## Changes to `api-contract.md` (brief — flagging, not designing)

`POST /api/simulate`'s response needs a small block so the frontend can caveat honestly:

- `pace_model.tier` — 1–4, which fallback produced the numbers
- `pace_model.degradation_per_lap` — what we derived, so it's inspectable
- `pace_model.beyond_evidence` — true when any hypothetical stint exceeds `A_race`
- The existing **Compound note** needs the same rewrite as the asymmetry section.

As built the block also carries `tier_source`, `source_driver_id` (so the UI can say
"modeled from Ricciardo"), `degradation_stderr`, `fuel_effect_per_lap`,
`hypothetical_max_tire_age` and `max_observed_stint_laps` — enough for the frontend to
draw the caveat without a second request. Plus the **409 `unsupported_conditions`**
response for a `mixed` race. `api-contract.md` is the authority.

## Out of scope for this iteration

- Cross-race or season-long degradation priors (erases the variation we want)
- Quadratic degradation *within* the observed range
- Real compound identification (needs FastF1)
- Modeling wet races rather than detecting and skipping them
- Tire warm-up / out-lap modeling — we drop out-laps rather than model them
- Track evolution (the circuit rubbering in over a race), which currently gets
  absorbed into the fuel coefficient and slightly inflates it

## Open questions — resolved

1. **Is tier 2 (team-mate substitution) worth the complexity for v1?** → **Yes, built.**
   See Step E. Verified against two real early retirements: Tsunoda (Monza 2024, retired
   lap 7, 4 usable laps) falls to Ricciardo's 0.042 s/lap, and Verstappen (Melbourne 2024,
   retired lap 3, 0 usable laps) falls to Pérez's 0.082 s/lap. Both would otherwise have
   got the generic 0.050 for every car at every circuit.
2. **`κ = 0.15 × degradation` is a guess.** → **Shipped as specified, then corrected.**
   Now `κ = 0.35 × field_median_degradation` — see Step G for why both the constant and
   the thing it scales off had to change. Still a judgement call, still not calibrated
   against a real long-stint race, and still labelled as one in the code.
3. **Should `conditions = 'mixed'` fall back to tier 4, or refuse?** → **Refuse.** 409
   with `code: "unsupported_conditions"`. See Step B.

## Still open after implementation

- **κ has to be calibrated** against a race with a genuinely long stint, so the
  extrapolation is anchored to at least one real data point. 0.35 is a better guess than
  0.15 was — it deters an unsurvivable stint, where 0.15 didn't — but it is still a guess.
- **The quality-gate thresholds** (8 / 5 laps, `−0.02` plausibility floor) were guesses in
  this document and are still guesses. They behave sensibly across five cached races, but
  "behaves sensibly" is not "validated".
- ~~**Near-zero derived degradation weakens Step G.**~~ **Fixed.** κ now scales off the
  field median, and the derived value is floored at
  `max(driver_degradation, 0.5 × field_median_degradation, 0.020)` — see Step G. The cost
  is the one predicted here: the three cars that fitted flat at Monza 2024 (Norris,
  Hamilton, Russell) now all sit on the same floored 0.029 s/lap, so the per-car
  character is gone for exactly those cars. `degradation_floored` in the response says
  when that has happened, which is the honest version of losing it.
- **The one-sided outlier trim can flatter a slope.** Dropping only slow laps removes
  traffic, but it also removes the slow end of a genuinely degrading stint. Mercedes at
  Monza 2024 fits at roughly zero degradation partly for this reason. The floor above
  bounds the damage; it does not fix the trim.
