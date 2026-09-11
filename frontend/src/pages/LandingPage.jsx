import { useState } from 'react'
import ScrollStory from '../components/ScrollStory'
import ActualStrategyScene from '../components/landing/ActualStrategyScene'
import ChangeStrategyScene from '../components/landing/ChangeStrategyScene'
import PickRaceScene from '../components/landing/PickRaceScene'
import ResultScene from '../components/landing/ResultScene'
import SimulatingScene from '../components/landing/SimulatingScene'
import {
  ACTUAL_STRATEGY,
  DEFAULT_HYPOTHETICAL_COMPOUND,
  MOCK_RACE,
} from '../lib/mockRaceData'

/**
 * The five beats of the landing story, in order.
 *
 * Built inside the component because scene content now depends on the selected race.
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
      // Next pass: this scene loads the selected race's real stints, so it takes
      // `selectedRace` from here. Until then it reads `src/lib/mockRaceData.js`.
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

export default function LandingPage() {
  // The picked race is owned here, not in scene 1 — scenes 2 onward read the same
  // selection.
  const [selectedRace, setSelectedRace] = useState(null)

  // The hypothetical call, owned here for the same reason: scene 3 edits it and scene 4
  // reads it back. The lap starts on the stop the driver actually made, so the user is
  // moving a real decision rather than filling in a blank. The compound can't come from
  // there — no data source publishes what the car actually fitted — so it starts on the
  // picker's own default. A race run without a stop has no real decision to start from,
  // so the lap starts mid-race instead. Next pass this becomes the `strategy` body of
  // `POST /api/simulate`.
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
      <section className="flex h-stage flex-col items-center justify-center px-6 text-center">
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

      <section className="flex h-[60vh] items-center justify-center px-6">
        <p className="text-sm text-neutral-500">End of story placeholder</p>
      </section>
    </main>
  )
}
