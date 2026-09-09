# API Contract

Base URL (dev): `http://localhost:8000/api`

Races are identified by **`season` + `round`**, matching how Jolpica identifies them
(`/ergast/f1/{season}/{round}/...`). There is no composite string id.

## Upstream field mapping

Our API returns snake_case and typed values. Jolpica returns camelCase/PascalCase and
**every scalar is a string**, including numbers. Cast on ingest.

| Our field | Jolpica source (path within `MRData.RaceTable.Races[0]`) | Note |
|---|---|---|
| `season` | `season` | string → int |
| `round` | `round` | string → int |
| `race_name` | `raceName` | |
| `circuit_id` | `Circuit.circuitId` | e.g. `monza` |
| `circuit_name` | `Circuit.circuitName` | e.g. `Autodromo Nazionale di Monza` |
| `date` | `date` | `YYYY-MM-DD` |
| `driver_id` | `Results[].Driver.driverId` | e.g. `leclerc` |
| `driver_name` | `Driver.givenName` + `Driver.familyName` | Jolpica has no single full-name field |
| `driver_code` | `Driver.code` | e.g. `LEC` |
| `constructor_id` | `Results[].Constructor.constructorId` | e.g. `ferrari` |
| `constructor_name` | `Results[].Constructor.name` | e.g. `Ferrari` |
| `grid` | `Results[].grid` | |
| `laps_completed` | `Results[].laps` | |
| `status` | `Results[].status` | e.g. `Finished`, `Lapped`, `Retired` |
| `finish_position` | `Results[].position` | Always numeric, even for retirements |
| `position_text` | `Results[].positionText` | `"1"`, `"R"`, `"D"`… — the real classification |
| `finish_time_ms` | `Results[].Time.millis` | **Absent entirely for non-classified drivers** |
| `pit_lap` | `PitStops[].lap` | |
| `pit_stop_number` | `PitStops[].stop` | 1-indexed per driver |
| `pit_duration_seconds` | `PitStops[].duration` | e.g. `"24.335"` → numeric. Total pit-lane loss, not stationary time |
| `lap_number` | `Laps[].number` | |
| `lap_time` | `Laps[].Timings[].time` | `"1:27.623"` — **mm:ss.SSS string, not seconds** |
| `lap_position` | `Laps[].Timings[].position` | |

Notes on the upstream shape:

- Everything is wrapped in `MRData.RaceTable.Races[]`. `Races` is an array even for a
  single race — an empty array means the season/round doesn't exist (Jolpica returns
  HTTP 200, not 404).
- `Results[].Time.time` is the *winner's* total time (`"1:14:40.727"`) but a **gap**
  (`"+22.820"`) for everyone else. Only `Time.millis` is a consistent total race time.
- `Time` is missing on retirements. Guard for it — don't assume the key exists.
- **Tire compound is not available from Jolpica at all.** No endpoint exposes it. See
  the compound note under `POST /api/simulate`.
- `/laps` is paginated by **individual driver timing**, not by lap. The 2024 Italian GP
  returns `total: 1008` with a default `limit: 30`. Page with `?limit=N&offset=M` until
  `offset + limit >= total`, or laps will silently truncate after lap 2.
- `PitStops` sits at the same level as `Results` (a sibling under `Races[0]`), so pit
  stops and results come from two separate requests and are joined on `driverId`.

---

## GET /api/races
List past races available to select from (cached from Jolpica, most recent seasons first).

**Query params**
| Param | Type | Required | Description |
|---|---|---|---|
| season | integer | no | Filter by season year, e.g. `2024` |
| limit | integer | no | Max results, default 50 |

**Response 200**
```json
[
  {
    "season": 2024,
    "round": 16,
    "race_name": "Italian Grand Prix",
    "circuit_id": "monza",
    "circuit_name": "Autodromo Nazionale di Monza",
    "date": "2024-09-01"
  }
]
```

---

## GET /api/races/{season}/{round}
Full detail for one race — drivers who took part, actual pit stops, and actual results.
Used to populate the Strategy Builder and as the baseline for comparison.

**Path params**
| Param | Type | Description |
|---|---|---|
| season | integer | Season year, e.g. `2024` |
| round | integer | Round within the season, e.g. `16` |

**Response 200**
```json
{
  "season": 2024,
  "round": 16,
  "race_name": "Italian Grand Prix",
  "circuit_id": "monza",
  "circuit_name": "Autodromo Nazionale di Monza",
  "date": "2024-09-01",
  "total_laps": 53,
  "drivers": [
    {
      "driver_id": "leclerc",
      "driver_code": "LEC",
      "driver_name": "Charles Leclerc",
      "constructor_id": "ferrari",
      "constructor_name": "Ferrari",
      "grid": 4,
      "actual_pit_stops": [
        { "stop": 1, "lap": 15, "duration_seconds": 24.109 }
      ],
      "actual_finish_position": 1,
      "actual_position_text": "1",
      "actual_status": "Finished",
      "actual_laps_completed": 53,
      "actual_finish_time_seconds": 4480.727
    }
  ]
}
```

- `total_laps` is derived — Jolpica has no such field. Use the winner's `Results[].laps`
  (equivalently `max(Results[].laps)`).
- `actual_finish_time_seconds` is `Time.millis / 1000`, and is `null` for any driver with
  no `Time` object (retirements).
- `actual_pit_stops` carries no compound — Jolpica doesn't publish it. The lap/duration
  values in the example above illustrate the shape only; real values come from
  `/pitstops.json` (verified there, e.g. `hulkenberg` lap 5, `"duration": "38.875"`;
  `gasly` lap 10, `"duration": "24.335"`).

**Response 404** — season/round not found upstream (Jolpica returns an empty `Races` array;
we translate that to a 404).

---

## POST /api/simulate
Runs the Monte Carlo simulation for a hypothetical strategy against a race's baseline.

**Request body**
```json
{
  "season": 2024,
  "round": 16,
  "driver_id": "leclerc",
  "strategy": [
    { "lap": 15, "compound_in": "medium" },
    { "lap": 35, "compound_in": "hard" }
  ],
  "num_simulations": 500
}
```

**Compound note.** `compound_in` is **user input only** — it's what the user picks on the
timeline UI, not something we can read back from Jolpica. Because the real stint compounds
are unknown, the baseline is the driver's actual *lap times*, not a reconstructed
compound-by-compound model. The simulation applies degradation to the hypothetical
strategy and compares against recorded actual lap times.

What that degradation is has changed. The **magnitude** of tire falloff is measured from
the driver's own recorded lap times for that race (`simulation-logic.md` Step 0), so a
Ferrari and a Sauber no longer degrade identically. The compound the user picks supplies
only the **ratio** — soft ×1.6, medium ×1.0, hard ×0.6 against that measured magnitude —
plus an absolute fresh-tire pace offset. We derive how fast a car's lap time fell away;
we still never assert which compound produced it. The response's `pace_model` block says
where the number came from.

**Response 200**
```json
{
  "season": 2024,
  "round": 16,
  "driver_id": "leclerc",
  "baseline_time_seconds": 4480.727,
  "simulated": {
    "mean_time_seconds": 4476.5,
    "median_time_seconds": 4476.2,
    "delta_vs_actual_seconds": -4.2,
    "finish_position_distribution": {
      "1": 412,
      "2": 78,
      "3": 10
    }
  },
  "lap_by_lap": [
    { "lap": 1, "hypothetical_position": 2, "actual_position": 2 },
    { "lap": 2, "hypothetical_position": 2, "actual_position": 2 }
  ],
  "pace_model": {
    "tier": 1,
    "tier_source": "driver",
    "source_driver_id": "leclerc",
    "degradation_per_lap": 0.05933,
    "degradation_floored": false,
    "degradation_stderr": 0.0067,
    "fuel_effect_per_lap": 0.05946,
    "beyond_evidence": false,
    "hypothetical_max_tire_age": 37,
    "max_observed_stint_laps": 41
  }
}
```

- `finish_position_distribution` — how many of the `num_simulations` runs ended in each position.
- `lap_by_lap` — track position per lap for both strategies, used to draw the Compare view
  chart (median run, not all 500). `actual_position` comes from
  `Laps[].Timings[].position`.

### The `pace_model` block

Always present. It exists so the frontend can caveat honestly: a tier-1 and a tier-4
answer are the same shape and deserve very different confidence.

| Field | Meaning |
|---|---|
| `tier` | `1` this driver's own laps, `2` their team-mate's, `3` the field median for this race, `4` the generic compound table |
| `tier_source` | `driver` \| `team-mate` \| `field` \| `generic` — the same thing, in words |
| `source_driver_id` | Whose laps the number came from. The driver at tier 1, their team-mate at tier 2, `null` at tiers 3 and 4 |
| `degradation_per_lap` | The measured falloff, medium-equivalent. The compound multiplier is applied on top of this, so it's the number to show, not the effective one |
| `degradation_floored` | `true` when the fitted slope came in under the physical floor and the floor is what `degradation_per_lap` reports. The number is then a lower bound on this car's tire wear, not a measurement of it |
| `degradation_stderr` | Standard error the Monte Carlo resamples with, already widened for extrapolation. A large value next to a small `degradation_per_lap` means "we don't really know" |
| `fuel_effect_per_lap` | Seconds gained per lap as fuel burns off, pooled across the field for this race |
| `beyond_evidence` | `true` when the strategy asks for a longer stint than **anyone** ran in this race. The result is an extrapolation; the chart should say so |
| `hypothetical_max_tire_age` | Longest stint the submitted strategy runs, in laps |
| `max_observed_stint_laps` | Longest stint anyone actually ran in this race — what `beyond_evidence` is measured against |

Suggested UI treatment: tier 1 needs no caveat; tier 2 should name the team-mate ("modeled
from Ricciardo's tire wear — Tsunoda retired on lap 7"); tier 3 and 4 should be visibly
approximate; `beyond_evidence` should mark the chart region past
`max_observed_stint_laps`. `degradation_floored` deserves its own line rather than being
folded into the tier, because it can be `true` at tier 1: the fit is the driver's own, it
just came back flatter than any tire behaves ("at least 0.029 s/lap — Norris's own laps
fit flatter than that, which we don't believe").

**Response 400** — invalid strategy (pit lap outside race length, unknown compound).

**Response 404** — race or driver not found.

**Response 409** — the *race* can't be simulated. Currently this means only one thing: the
race ran in wet or changing conditions, which the tire model does not support.

```json
{
  "detail": {
    "code": "unsupported_conditions",
    "message": "Season 2023 round 13 ran in wet or changing conditions, which the tire model does not support.",
    "season": 2023,
    "round": 13,
    "conditions": "mixed"
  }
}
```

Detected two ways, because they catch different races: a race that *changes* conditions
shows a sustained block of laps off its own median, while a race that was wet from lights
to flag looks perfectly normal against itself and is only visible against the same
circuit's pace in other cached races. The second check needs at least one other race at
that circuit already fitted as dry; on a circuit we have only seen once, a lights-to-flag
wet race is still undetectable and will be simulated. See degradation-model.md, Step B.

A wet or drying race makes lap times move for reasons that have nothing to do with tire
age, so any degradation fitted from it is garbage. We could fall back to the generic
compound table and still return a number — and that is the wrong answer, because the
number would look exactly as confident as a real one. The frontend should show "this race
can't be simulated — wet/mixed conditions" and offer a different race.

**409, not 400**, deliberately: nothing about the submitted strategy is wrong, so the UI
must not blame the user's pit laps. Branch on `detail.code`; `conditions` is included so
the message can be specific. FastAPI's own validation errors are 422 with a *list* under
`detail`, so the two never collide.

The race is still ingested and `GET /api/races/{season}/{round}` still returns it in full —
only simulation is refused.
