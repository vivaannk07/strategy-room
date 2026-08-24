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
| `status` | `Results[].status` | e.g. `Finished`, `+1 Lap`, `Retired` |
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
compound-by-compound model. For v1 the simulation applies degradation curves to the
hypothetical strategy and compares against recorded actual lap times.

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
  ]
}
```

- `finish_position_distribution` — how many of the `num_simulations` runs ended in each position.
- `lap_by_lap` — track position per lap for both strategies, used to draw the Compare view
  chart (median run, not all 500). `actual_position` comes from
  `Laps[].Timings[].position`.

**Response 400** — invalid strategy (pit lap outside race length, unknown compound).
**Response 404** — race or driver not found.
