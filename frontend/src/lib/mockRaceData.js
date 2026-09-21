/**
 * Mock race data for the offline landing story, served when the URL has `?mock=true`.
 *
 * Only the mock flow reads this — `src/pages/MockLandingPage.jsx` and the scenes in
 * `src/components/landing/mock/`, which are the landing story as it was before the
 * real-backend wiring. The default flow never imports it. `MOCK_RACES` stands in for
 * `GET /api/races`, `MOCK_RACE` / `ACTUAL_STRATEGY` / `ACTUAL_LAPS` for
 * `GET /api/races/{season}/{round}`, and `HYPOTHETICAL_LAPS` / `RESULT_DELTA` for
 * `POST /api/simulate`. Nothing here touches the network.
 *
 * Two things that hold for this data as much as the real thing:
 *
 * 1. Jolpica publishes no tire data, so nothing on the *actual* side carries a compound —
 *    not the stops, not the stints, not the opening tyre. `api-contract.md` and
 *    `frontend-plan.md` are both explicit that the UI must not label real stints
 *    soft/medium/hard, so an actual stop is `{ lap, duration_seconds }` and that is all
 *    the markers can show. Compound is user input, and lives only on the hypothetical
 *    strategy. The toy model still needs a compound per stint to produce plausible lap
 *    times; that lives in `paceCompound`, which never reaches the UI — see `buildStints`.
 * 2. Lap times here come from the toy model below (fuel burn-off + linear tire
 *    degradation + a deterministic wobble), not from recorded timing. The real flow gets
 *    recorded lap times from `GET /api/races/{season}/{round}/drivers/{driver_id}/laps`.
 */

/* ------------------------------------------------------------------ *
 * Domain constants — these survive the swap to real data.
 * ------------------------------------------------------------------ */

/**
 * The three compounds the user can pick for a hypothetical stint.
 *
 * `ratio` mirrors the simulation's compound multiplier against the driver's measured
 * degradation magnitude (see `degradation-model.md`): soft ×1.6, medium ×1.0, hard ×0.6.
 * `freshOffset` is the fresh-tire pace offset in seconds per lap.
 */
export const COMPOUNDS = [
  {
    id: 'soft',
    label: 'Soft',
    ratio: 1.6,
    freshOffset: -0.25,
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
    freshOffset: 0.3,
    color: '#e5e5e5',
    dot: 'bg-neutral-300',
    chip: 'border-neutral-300 bg-neutral-300/10 text-neutral-100',
  },
]

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

/* ------------------------------------------------------------------ *
 * Mock race — replace wholesale with the selected race's detail.
 * ------------------------------------------------------------------ */

export const MOCK_RACE = {
  season: 2024,
  round: 16,
  race_name: 'Italian Grand Prix',
  circuit_name: 'Autodromo Nazionale di Monza',
  total_laps: 53,
  driver_id: 'leclerc',
  driver_code: 'LEC',
  driver_name: 'Charles Leclerc',
  constructor_name: 'Ferrari',
  actual_finish_position: 1,
}

/** Scene 1's race list: the one mock race, in the shape `GET /api/races` returns. */
export const MOCK_RACES = [
  {
    season: MOCK_RACE.season,
    round: MOCK_RACE.round,
    race_name: MOCK_RACE.race_name,
    circuit_id: 'monza',
    circuit_name: MOCK_RACE.circuit_name,
    date: '2024-09-01',
  },
]

/**
 * The stops as they actually happened — lap and total pit-lane loss, nothing else.
 *
 * No `compound`, deliberately: this is the shape `actual_pit_stops` comes back in from
 * `GET /api/races/{season}/{round}`, and a compound here would be a claim the data can't
 * support. Anything rendering these shows lap + duration.
 */
export const ACTUAL_STRATEGY = [
  { stop: 1, lap: 15, duration_seconds: 24.1 },
  { stop: 2, lap: 35, duration_seconds: 23.6 },
]

/**
 * What the toy lap-time model runs the actual race on, stint by stint.
 *
 * Not a claim about what the car was actually on — purely what the synthesiser needs to
 * generate a believable lap trace. Exported only so every `buildStints` call on the
 * actual strategy agrees with `ACTUAL_LAPS`; never display it. It disappears the moment
 * real recorded lap times replace `ACTUAL_LAPS`.
 */
export const ACTUAL_PACE_COMPOUNDS = ['medium', 'medium', 'hard']

/**
 * The tyre the model assumes both strategies start on. Same caveat: a synthesis input,
 * never displayed — the opening stint's compound is unpublished for every driver.
 */
const START_PACE_COMPOUND = 'medium'

/**
 * The counterfactual scene 5 compares against: stay out nine laps longer, then soft.
 *
 * Every stop here carries a compound because every stop here is user input — this is the
 * `strategy` array that goes to `POST /api/simulate` as `compound_in`.
 */
export const HYPOTHETICAL_STRATEGY = [
  { stop: 1, lap: 24, compound: 'soft', duration_seconds: 24.1 },
  { stop: 2, lap: 35, compound: 'hard', duration_seconds: 23.6 },
]

/** What scene 3's compound picker starts on. A UI default, not a fact about the race. */
export const DEFAULT_HYPOTHETICAL_COMPOUND = 'medium'

/* ------------------------------------------------------------------ *
 * Toy lap-time model. Stands in for recorded timing + the real sim.
 * ------------------------------------------------------------------ */

const PACE = {
  /** Clean-air reference lap on a fresh medium with a full tank. */
  baseLap: 84.2,
  /** Seconds the car gains per lap as fuel burns off. */
  fuelGainPerLap: 0.055,
  /** Seconds lost per lap of tire age, at compound ratio 1.0. */
  degPerTireLap: 0.095,
  /** Standing start costs the opening lap. */
  standingStartLoss: 2.4,
  /** Total pit-lane loss charged to the lap the car pits on. */
  pitLaneLoss: 21.5,
}

/**
 * Deterministic stand-in for traffic, driver variance and track evolution.
 *
 * Deliberately not `Math.random()`: these charts re-render on every scroll tick and on
 * every slider move, and a random term would make the line jitter under the cursor.
 */
function wobble(lap) {
  return 0.11 * Math.sin(lap * 1.7) + 0.06 * Math.sin(lap * 0.53)
}

/**
 * Turns a list of stops into the stints they imply.
 *
 * A stop on lap L is served during lap L, so L is the last lap of the outgoing stint
 * and the new tyre runs from L + 1.
 *
 * Each stint gets two compounds, and the split is the whole point:
 *
 * - `compound` is what the UI may display. It is only ever taken from a stop that
 *   declared one, so it is `undefined` for the opening stint (nobody publishes the
 *   starting tyre) and `undefined` throughout an actual strategy (whose stops carry no
 *   compound at all). Renderers must treat it as optional.
 * - `paceCompound` is what the lap-time model runs on. It always resolves to something,
 *   falling back through `paceCompounds[i]` to the declared compound to medium.
 *
 * @param {Array<string>} paceCompounds  Per-stint synthesis compounds, by stint index.
 */
export function buildStints(
  strategy,
  { totalLaps = MOCK_RACE.total_laps, paceCompounds = [] } = {},
) {
  const stops = [...strategy].sort((a, b) => a.lap - b.lap)
  const stints = []
  let startLap = 1
  // Left undefined on purpose: the tyre the car started the race on is not knowable.
  let compound

  for (const stop of stops) {
    stints.push({ compound, startLap, endLap: stop.lap, pitsAfter: stop })
    startLap = stop.lap + 1
    compound = stop.compound
  }
  stints.push({ compound, startLap, endLap: totalLaps, pitsAfter: null })

  // Mapped before filtering so `paceCompounds` stays aligned to stint position even if a
  // zero-length stint (two stops on consecutive laps) drops out.
  return stints
    .map((stint, index) => ({
      ...stint,
      laps: stint.endLap - stint.startLap + 1,
      paceCompound: paceCompounds[index] ?? stint.compound ?? 'medium',
    }))
    .filter((stint) => stint.laps > 0)
}

/**
 * Lap-by-lap pace for one strategy.
 *
 * `pace_seconds` is the lap on its merits — that's what the charts plot, because a
 * +21s pit lap would flatten every other lap into a straight line. `lap_time_seconds`
 * includes the pit-lane loss and is what the race total is summed from.
 *
 * Rows carry the stint's *display* compound, so laps on the actual side — and every
 * opening stint — report no compound at all. Tooltips must render it conditionally.
 */
export function buildLapTimes(
  strategy,
  { totalLaps = MOCK_RACE.total_laps, paceCompounds = [] } = {},
) {
  const stints = buildStints(strategy, { totalLaps, paceCompounds })
  const rows = []

  for (const stint of stints) {
    const { ratio, freshOffset } = compoundById(stint.paceCompound)

    for (let lap = stint.startLap; lap <= stint.endLap; lap += 1) {
      const tireAge = lap - stint.startLap
      const isPitLap = stint.pitsAfter?.lap === lap

      const pace =
        PACE.baseLap -
        PACE.fuelGainPerLap * (lap - 1) +
        freshOffset +
        PACE.degPerTireLap * ratio * tireAge +
        wobble(lap) +
        (lap === 1 ? PACE.standingStartLoss : 0)

      rows.push({
        lap,
        tire_age: tireAge,
        compound: stint.compound,
        is_pit_lap: isPitLap,
        pace_seconds: Number(pace.toFixed(3)),
        lap_time_seconds: Number((pace + (isPitLap ? PACE.pitLaneLoss : 0)).toFixed(3)),
      })
    }
  }

  return rows
}

/** Total race time for a lap set, in seconds. */
export function raceTimeSeconds(laps) {
  return laps.reduce((total, lap) => total + lap.lap_time_seconds, 0)
}

export const ACTUAL_LAPS = buildLapTimes(ACTUAL_STRATEGY, {
  paceCompounds: ACTUAL_PACE_COMPOUNDS,
})
// Only the opening stint needs a synthesis compound — the rest come from the user's stops.
export const HYPOTHETICAL_LAPS = buildLapTimes(HYPOTHETICAL_STRATEGY, {
  paceCompounds: [START_PACE_COMPOUND],
})

export const ACTUAL_RACE_TIME = raceTimeSeconds(ACTUAL_LAPS)
export const HYPOTHETICAL_RACE_TIME = raceTimeSeconds(HYPOTHETICAL_LAPS)

/**
 * Scene 5's headline. Derived from the two mock lap sets rather than written out, so
 * the number can't drift away from the charts sitting next to it.
 */
const deltaSeconds = Number((HYPOTHETICAL_RACE_TIME - ACTUAL_RACE_TIME).toFixed(1))

export const RESULT_DELTA = {
  seconds: deltaSeconds,
  isSlower: deltaSeconds > 0,
  label: `${deltaSeconds > 0 ? '+' : ''}${deltaSeconds.toFixed(1)}s ${
    deltaSeconds > 0 ? 'slower' : 'faster'
  }`,
}

/**
 * Shared y-axis bounds for scene 5, so the two panels are read against one scale — a
 * per-panel auto domain would let a slower race draw an identical-looking chart.
 */
export const SHARED_PACE_DOMAIN = (() => {
  const paces = [...ACTUAL_LAPS, ...HYPOTHETICAL_LAPS].map((lap) => lap.pace_seconds)
  return [Math.floor(Math.min(...paces) - 0.5), Math.ceil(Math.max(...paces) + 0.5)]
})()

/**
 * Scene 4's degradation fan: seconds lost per lap against tire age, per compound —
 * the same `ratio` / `freshOffset` the lap-time model uses.
 */
export function buildDegradationSeries(maxAge = 28) {
  return COMPOUNDS.map((compound) => ({
    compound,
    points: Array.from({ length: maxAge + 1 }, (_, age) => ({
      age,
      delta: Number(
        (compound.freshOffset + PACE.degPerTireLap * compound.ratio * age).toFixed(3),
      ),
    })),
  }))
}
