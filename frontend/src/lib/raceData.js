/**
 * Domain helpers for the landing story: compounds, formatting, and the shapes the scenes
 * derive from API responses. No data lives here — everything comes from `src/lib/api.js`.
 *
 * Jolpica publishes no tire data, so nothing on the *actual* side carries a compound —
 * not the stops, not the stints, not the opening tyre. Compound is user input and lives
 * only on the hypothetical strategy (`compound_in`).
 */

/** Iterations per `POST /api/simulate` — the documented working point. */
export const MONTE_CARLO_RUNS = 500

/**
 * The three compounds the user can pick for a hypothetical stint.
 *
 * Mirrors `COMPOUND_MODEL` in `backend/app/simulation.py`: `ratio` is the compound's
 * multiplier on the measured degradation (soft ×1.6, medium ×1.0, hard ×0.6) and
 * `freshOffset` its fresh-tire pace offset in seconds per lap. The backend also accepts
 * intermediate and wet, but a wet race is refused outright, so they aren't offered.
 */
export const COMPOUNDS = [
  {
    id: 'soft',
    label: 'Soft',
    ratio: 1.6,
    freshOffset: -0.3,
    color: '#ef4444',
    dot: 'bg-red-500',
    chip: 'border-red-500 bg-red-500/10 text-red-300',
  },
  {
    id: 'medium',
    label: 'Medium',
    ratio: 1.0,
    freshOffset: 0,
    color: '#fbbf24',
    dot: 'bg-amber-400',
    chip: 'border-amber-400 bg-amber-400/10 text-amber-200',
  },
  {
    id: 'hard',
    label: 'Hard',
    ratio: 0.6,
    freshOffset: 0.4,
    color: '#e5e5e5',
    dot: 'bg-neutral-300',
    chip: 'border-neutral-300 bg-neutral-300/10 text-neutral-100',
  },
]

/**
 * Medium-equivalent seconds lost per lap of tire age in the backend's generic table
 * (tier 4). Scene 4 draws with it until a simulation returns the measured number.
 */
export const GENERIC_DEGRADATION_PER_LAP = 0.05

/** What scene 3's compound picker starts on. A UI default, not a fact about the race. */
export const DEFAULT_HYPOTHETICAL_COMPOUND = 'medium'

/**
 * The compound sent for the driver's later real stops, which the user doesn't move. The
 * API needs one per stop and the real one is unknowable, so they take medium — the same
 * neutral assumption the backend makes for every opening stint.
 */
export const KEPT_STOP_COMPOUND = 'medium'

/** The earliest lap a stop can be placed on. `POST /api/simulate` accepts 1…total_laps. */
export const MIN_PIT_LAP = 1

/**
 * What to tell the user when `POST /api/simulate` fails. A 409 `unsupported_conditions`
 * is about the race, not the user's call, so it says so and points at a different race
 * rather than blaming the pit laps.
 */
export function simulationErrorMessage(error) {
  return error.code === 'unsupported_conditions'
    ? "This race ran in wet or mixed conditions, which the tyre model can't simulate. Pick a different race in scene 1."
    : error.message
}

/** Compound lookup that never returns undefined — falls back to medium. */
export function compoundById(id) {
  return COMPOUNDS.find((compound) => compound.id === id) ?? COMPOUNDS[1]
}

/** Seconds → `1:24.3`, the way a timing screen shows a lap. */
export function formatLapTime(seconds, decimals = 1) {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds - minutes * 60
  return `${minutes}:${rest.toFixed(decimals).padStart(decimals + 3, '0')}`
}

/** Seconds → `1:24:40.7`, the way a classification shows a race time. */
export function formatRaceTime(seconds) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds - hours * 3600) / 60)
  const rest = seconds - hours * 3600 - minutes * 60
  return `${hours}:${String(minutes).padStart(2, '0')}:${rest.toFixed(1).padStart(4, '0')}`
}

/** `3 stops`, `1 stop`, `No stops`. */
export function formatStopCount(count) {
  if (count === 0) return 'No stops'
  return `${count} stop${count === 1 ? '' : 's'}`
}

/**
 * The last lap this driver actually ran. A retirement ends the race early for them, and
 * the simulation stops there too — nothing past it is modeled.
 */
export function driverLastLap(driver, totalLaps) {
  return Math.min(totalLaps, driver.actual_laps_completed || totalLaps)
}

/**
 * Turns a list of stops into the stints they imply.
 *
 * A stop on lap L is served during lap L, so L is the last lap of the outgoing stint
 * and the new tyre runs from L + 1.
 *
 * `compound` is only ever taken from a stop's `compound_in`, so it is `undefined` for the
 * opening stint (nobody publishes the starting tyre) and throughout an actual strategy
 * (whose stops carry no compound at all). Renderers must treat it as optional.
 */
export function buildStints(stops, lastLap) {
  const sorted = [...stops].sort((a, b) => a.lap - b.lap)
  const stints = []
  let startLap = 1
  // Left undefined on purpose: the tyre the car started the race on is not knowable.
  let compound

  for (const stop of sorted) {
    stints.push({ compound, startLap, endLap: stop.lap, pitsAfter: stop })
    startLap = stop.lap + 1
    compound = stop.compound_in
  }
  stints.push({ compound, startLap, endLap: lastLap, pitsAfter: null })

  return stints
    .map((stint) => ({ ...stint, laps: stint.endLap - stint.startLap + 1 }))
    .filter((stint) => stint.laps > 0)
}

/**
 * The laps the user's stop can go on for this driver: from `MIN_PIT_LAP` up to one lap
 * short of their second real stop, so the stops can't cross — a range that can't produce
 * an invalid strategy needs no validation message. With no second stop, up to one lap
 * short of the driver's last lap, so the new tyre always gets at least one lap.
 *
 * `max < min` means there's no room to place a stop at all (a lap-1 retirement).
 */
export function pitLapRange(driver, totalLaps) {
  const nextStop = driver.actual_pit_stops[1]
  const max = (nextStop?.lap ?? driverLastLap(driver, totalLaps)) - 1
  return { min: MIN_PIT_LAP, max }
}

/**
 * Where scene 3's slider starts for a newly picked driver: on the stop they actually
 * made, so the user is moving a real decision. A driver who never stopped has no decision
 * to start from, so the slider starts mid-range instead.
 */
export function initialPitLap(driver, totalLaps) {
  const { min, max } = pitLapRange(driver, totalLaps)
  const firstStop = driver.actual_pit_stops[0]?.lap
  const lap = firstStop ?? Math.round((min + max) / 2)
  return Math.min(Math.max(lap, min), Math.max(min, max))
}

/**
 * The `strategy` body for `POST /api/simulate`: the user's stop in place of the driver's
 * first real one, then every later real stop kept on its real lap.
 */
export function buildHypotheticalStrategy(driver, pitCall) {
  return [
    { lap: pitCall.lap, compound_in: pitCall.compound },
    ...driver.actual_pit_stops
      .slice(1)
      .map((stop) => ({ lap: stop.lap, compound_in: KEPT_STOP_COMPOUND })),
  ]
}

/**
 * Recorded laps → the rows scene 2's chart plots.
 *
 * `pace_seconds` is null on a stop's in-lap and out-lap. The ~20s of pit-lane loss is
 * split across those two, and plotting them would compress every other lap in the race
 * into a flat line; the stops are drawn as markers instead. `tire_age` counts laps since
 * the last stop — knowable from the stop laps, unlike the compound.
 */
export function buildPaceSeries(laps, pitStops) {
  const stopLaps = pitStops.map((stop) => stop.lap).sort((a, b) => a - b)
  const pitAffected = new Set(stopLaps.flatMap((lap) => [lap, lap + 1]))

  return laps.map((row) => {
    const lastStop = stopLaps.findLast((lap) => lap < row.lap)
    const isPitLap = pitAffected.has(row.lap)

    return {
      lap: row.lap,
      tire_age: row.lap - (lastStop ?? 0) - 1,
      is_pit_lap: isPitLap,
      lap_time_seconds: row.lap_time_seconds,
      pace_seconds: isPitLap ? null : row.lap_time_seconds,
    }
  })
}

/** Quickest recorded lap, or null when the driver has no timed laps. */
export function fastestLap(laps) {
  return laps.reduce(
    (best, lap) =>
      lap.lap_time_seconds != null &&
      (best == null || lap.lap_time_seconds < best.lap_time_seconds)
        ? lap
        : best,
    null,
  )
}

/**
 * Scene 4's degradation fan: seconds lost against tire age, per compound, for a given
 * medium-equivalent falloff — the same `ratio` / `freshOffset` the backend applies.
 */
export function buildDegradationSeries(degradationPerLap, maxAge) {
  return COMPOUNDS.map((compound) => ({
    compound,
    points: Array.from({ length: maxAge + 1 }, (_, age) => ({
      age,
      delta: compound.freshOffset + degradationPerLap * compound.ratio * age,
    })),
  }))
}
