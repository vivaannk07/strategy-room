import { useState } from 'react'
import ScrollStory from '../components/ScrollStory'
import ActualStrategyScene from '../components/landing/mock/ActualStrategyScene'
import ChangeStrategyScene from '../components/landing/mock/ChangeStrategyScene'
import PickRaceScene from '../components/landing/mock/PickRaceScene'
import ResultScene from '../components/landing/mock/ResultScene'
import SimulatingScene from '../components/landing/mock/SimulatingScene'
import {
  ACTUAL_STRATEGY,
  DEFAULT_HYPOTHETICAL_COMPOUND,
  MOCK_RACE,
} from '../lib/mockRaceData'

/**
 * The five beats of the mock landing story, in order.
 *
 * Built inside the component because scene content depends on the selected race.
 * Scene identity comes from `id`, not array identity, so rebuilding this list on each
 * render re-renders the scenes without disturbing their scroll transforms.
 */
function buildScenes({ selectedRace, onSelectRace, pitStrategy, onChangeStrategy }) {
  return [
    {
      id: 'pick-race',
      label: 'Pick a race',
      content: (
        <PickRaceScene
          selectedRace={selectedRace}
          onSelectRace={onSelectRace}
        />
      ),
    },
    {
      id: 'actual-strategy',
      label: "Driver's actual strategy",
      // Reads `src/lib/mockRaceData.js` directly, whatever race is selected.
      content: <ActualStrategyScene />,
    },
    {
      id: 'change-strategy',
      label: 'Change the pit strategy',
      content: (
        <ChangeStrategyScene
          strategy={pitStrategy}
          onChange={onChangeStrategy}
        />
      ),
    },
    {
      id: 'simulating',
      label: 'Simulating',
      content: ({ progress }) => (
        <SimulatingScene progress={progress} strategy={pitStrategy} />
      ),
    },
    {
      id: 'result',
      label: 'Result: hypothetical vs actual',
      content: <ResultScene />,
    },
  ]
}

/**
 * The landing story as it ran before the real-backend wiring, fed entirely by
 * `src/lib/mockRaceData.js` with no network calls. Mounted by <App> only when the URL
 * has `?mock=true`, for offline dev and demos; the default is <LandingPage>.
 *
 * The scenes in `components/landing/mock/` are frozen copies of that pre-wiring flow, so
 * changes to the real scenes don't carry over here.
 */
export default function MockLandingPage() {
  // The picked race is owned here, not in scene 1 — scenes 2 onward read the same
  // selection.
  const [selectedRace, setSelectedRace] = useState(null)

  // The hypothetical call, owned here for the same reason: scene 3 edits it and scene 4
  // reads it back. The lap starts on the stop the driver actually made, so the user is
  // moving a real decision rather than filling in a blank. The compound can't come from
  // there — no data source publishes what the car actually fitted — so it starts on the
  // picker's own default. A race run without a stop has no real decision to start from,
  // so the lap starts mid-race instead.
  const [pitStrategy, setPitStrategy] = useState({
    lap: ACTUAL_STRATEGY[0]?.lap ?? Math.round(MOCK_RACE.total_laps / 2),
    compound: DEFAULT_HYPOTHETICAL_COMPOUND,
  })
  const changeStrategy = (patch) =>
    setPitStrategy((current) => ({ ...current, ...patch }))

  const scenes = buildScenes({
    selectedRace,
    onSelectRace: setSelectedRace,
    pitStrategy,
    onChangeStrategy: changeStrategy,
  })

  return (
    <main className="bg-neutral-950 text-neutral-100">
      <section className="safe-px safe-py flex h-stage flex-col items-center justify-center [--pad-x:1.5rem] [--pad-y:2.5rem] text-center">
        <p className="text-[0.7rem] font-medium tracking-[0.3em] text-red-500 uppercase">
          Strategy Room
        </p>
        <h1 className="mt-4 max-w-2xl text-4xl font-semibold text-balance sm:text-6xl">
          Rewrite the pit wall's call
        </h1>
        <p className="mt-5 max-w-md text-sm text-pretty text-neutral-400 sm:text-base">
          Take a real Grand Prix, move the stop, and watch the race run again.
        </p>
        <p className="mt-14 text-[0.65rem] tracking-[0.3em] text-neutral-600 uppercase">
          Scroll
        </p>
      </section>

      <ScrollStory id="story" scenes={scenes} />

      <section className="safe-px flex h-[60svh] items-center justify-center [--pad-x:1.5rem] pb-[env(safe-area-inset-bottom)]">
        <p className="text-sm text-neutral-500">End of story placeholder</p>
      </section>
    </main>
  )
}
