import SceneFrame from '../SceneFrame'
import LapPaceChart from './LapPaceChart'
import {
  ACTUAL_LAPS,
  ACTUAL_RACE_TIME,
  ACTUAL_STRATEGY,
  HYPOTHETICAL_LAPS,
  HYPOTHETICAL_RACE_TIME,
  HYPOTHETICAL_STRATEGY,
  MOCK_RACE,
  RESULT_DELTA,
  SHARED_PACE_DOMAIN,
  compoundById,
  formatRaceTime,
} from '../../../lib/mockRaceData'

const PANELS = [
  {
    key: 'actual',
    label: 'Actual',
    accent: '#a3a3a3',
    laps: ACTUAL_LAPS,
    strategy: ACTUAL_STRATEGY,
    raceTime: ACTUAL_RACE_TIME,
  },
  {
    key: 'hypothetical',
    label: 'Hypothetical',
    accent: '#ef4444',
    laps: HYPOTHETICAL_LAPS,
    strategy: HYPOTHETICAL_STRATEGY,
    raceTime: HYPOTHETICAL_RACE_TIME,
  },
]

/**
 * Scene 5 — the two races side by side.
 *
 * Both panels share one y-axis domain (`SHARED_PACE_DOMAIN`), so the shapes are
 * comparable by eye; per-panel auto domains would scale the slower race to look like the
 * faster one. The delta is computed off the same two mock lap sets the charts draw, so
 * the headline can't contradict them.
 *
 * Still the fixed mock counterfactual, not the user's call from scene 3 — wiring this to
 * the real `POST /api/simulate` response is the next pass.
 */
export default function ResultScene() {
  return (
    <SceneFrame
      step={5}
      title="Hypothetical vs. actual"
      subtitle="Where the two races diverge, and the lap it stopped being close."
    >
      <div className="mx-auto max-w-3xl">
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
          {PANELS.map((panel) => (
            <div
              key={panel.key}
              className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4 sm:p-5"
            >
              <div className="flex items-baseline justify-between gap-3 text-left">
                <p
                  className="text-[0.65rem] tracking-[0.2em] uppercase"
                  style={{ color: panel.accent }}
                >
                  {panel.label}
                </p>
                <p className="text-xs text-neutral-500 tabular-nums">
                  {formatRaceTime(panel.raceTime)}
                </p>
              </div>

              <div className="mt-2 h-36 w-full sm:h-40">
                <LapPaceChart
                  id={panel.key}
                  laps={panel.laps}
                  strategy={panel.strategy}
                  accent={panel.accent}
                  domain={SHARED_PACE_DOMAIN}
                  stopLabels="short"
                  ariaLabel={`${panel.label} lap pace, stopping on laps ${panel.strategy
                    .map((stop) => stop.lap)
                    .join(' and ')}.`}
                />
              </div>

              <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-left">
                {/*
                  The hypothetical's stops are the user's own picks, so they name a
                  compound. The actual's can't — they show the pit-lane time instead.
                */}
                {panel.strategy.map((stop) => {
                  const compound = stop.compound ? compoundById(stop.compound) : null

                  return (
                    <li
                      key={stop.stop}
                      className="flex items-center gap-1.5 text-[0.7rem] text-neutral-500 tabular-nums"
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          compound ? compound.dot : 'bg-neutral-600'
                        }`}
                      />
                      L{stop.lap}{' '}
                      {compound
                        ? compound.label
                        : `${stop.duration_seconds.toFixed(1)}s`}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1">
          <p
            className={`text-2xl font-semibold tabular-nums sm:text-3xl ${
              RESULT_DELTA.isSlower ? 'text-red-400' : 'text-emerald-400'
            }`}
          >
            {RESULT_DELTA.label}
          </p>
          <p className="text-sm text-neutral-500">
            over {MOCK_RACE.total_laps} laps — stopping on lap{' '}
            {HYPOTHETICAL_STRATEGY[0].lap} instead of{' '}
            {ACTUAL_STRATEGY[0] ? ACTUAL_STRATEGY[0].lap : 'running without a stop'}
          </p>
        </div>
      </div>
    </SceneFrame>
  )
}
