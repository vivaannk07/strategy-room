import { useState } from 'react'
import ScrollStory from '../components/ScrollStory'
import ActualStrategyScene from '../components/landing/ActualStrategyScene'
import ChangeStrategyScene from '../components/landing/ChangeStrategyScene'
import PickRaceScene from '../components/landing/PickRaceScene'
import ResultScene from '../components/landing/ResultScene'
import SimulatingScene from '../components/landing/SimulatingScene'

/**
 * The five beats of the landing story, in order.
 *
 * Built inside the component because scene content now depends on the selected race.
 * Scene identity comes from `id`, not array identity, so rebuilding this list on each
 * render re-renders the scenes without disturbing their scroll transforms.
 */
function buildScenes({ selectedRace, onSelectRace }) {
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
      // `selectedRace` from here.
      content: <ActualStrategyScene />,
    },
    {
      id: 'change-strategy',
      label: 'Change the pit strategy',
      content: <ChangeStrategyScene />,
    },
    {
      id: 'simulating',
      label: 'Simulating',
      content: ({ progress }) => <SimulatingScene progress={progress} />,
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
  const scenes = buildScenes({ selectedRace, onSelectRace: setSelectedRace })

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
