import { useState } from 'react'
import ScrollStory from '../components/ScrollStory'
import ActualStrategyScene from '../components/landing/ActualStrategyScene'
import ChangeStrategyScene from '../components/landing/ChangeStrategyScene'
import { ACTUAL_COLOR } from '../components/landing/PositionChart'
import PickRaceScene from '../components/landing/PickRaceScene'
import ResultScene from '../components/landing/ResultScene'
import SimulatingScene from '../components/landing/SimulatingScene'
import StoryBackdrop from '../components/landing/StoryBackdrop'
import { fetchDriverLaps, fetchRaceDetail, runSimulation } from '../lib/api'
import {
  DEFAULT_HYPOTHETICAL_COMPOUND,
  MONTE_CARLO_RUNS,
  NEUTRAL_TINT,
  NO_WIN_TINT,
  WIN_TINT,
  buildHypotheticalStrategy,
  compoundTint,
  initialPitLap,
  simulationBeatsActual,
} from '../lib/raceData'
import { useApiResource } from '../lib/useApiResource'

// Loaders for `useApiResource`. Module scope so they're stable; everything that varies
// travels in the params object.
const loadRaceDetail = ({ season, round }, signal) =>
  fetchRaceDetail({ season, round, signal })
const loadDriverLaps = ({ season, round, driverId }, signal) =>
  fetchDriverLaps({ season, round, driverId, signal })
const loadSimulation = (request, signal) => runSimulation({ ...request, signal })

/**
 * The backdrop tint for each of the five scenes, in order, from state the scenes already
 * read. Every colour resolves through `compoundTint` or a named constant, so an unknown or
 * missing compound lands on neutral rather than an undefined colour.
 */
function buildTints({ driver, pitCall, simulation }) {
  const hypothetical = compoundTint(pitCall.compound)
  const won =
    driver != null &&
    simulation.status === 'ready' &&
    simulationBeatsActual(simulation.data, driver)

  return [
    { color: NEUTRAL_TINT, strength: 0.5 },
    // No F1 data source publishes tyre compounds, so the actual strategy never gets a
    // compound colour. Grey means "what really happened", colour means "your hypothetical".
    { color: ACTUAL_COLOR, strength: 1 },
    { color: hypothetical, strength: 1 },
    // Scene 4 simulates the call made in scene 3, so it keeps scene 3's colour.
    { color: hypothetical, strength: 1 },
    { color: won ? WIN_TINT : NO_WIN_TINT, strength: 1 },
  ]
}

/**
 * The five beats of the landing story, in order.
 *
 * Built inside the component because scene content depends on the selections and
 * requests. Scene identity comes from `id`, not array identity, so rebuilding this list
 * on each render re-renders the scenes without disturbing their scroll transforms.
 */
function buildScenes({
  selectedRace,
  onSelectRace,
  raceDetail,
  race,
  driver,
  onSelectDriver,
  driverLaps,
  pitCall,
  onChangePitCall,
  simulation,
  onRequestSimulation,
}) {
  return [
    {
      id: 'pick-race',
      label: 'Pick a race',
      content: (
        <PickRaceScene
          selectedRace={selectedRace}
          onSelectRace={onSelectRace}
          raceDetail={raceDetail}
          selectedDriverId={driver?.driver_id ?? null}
          onSelectDriver={onSelectDriver}
        />
      ),
    },
    {
      id: 'actual-strategy',
      label: "Driver's actual strategy",
      content: <ActualStrategyScene race={race} driver={driver} laps={driverLaps} />,
    },
    {
      id: 'change-strategy',
      label: 'Change the pit strategy',
      content: (
        <ChangeStrategyScene
          race={race}
          driver={driver}
          strategy={pitCall}
          onChange={onChangePitCall}
        />
      ),
    },
    {
      id: 'simulating',
      label: 'Simulating',
      content: ({ progress, isActive }) => (
        <SimulatingScene
          progress={progress}
          isActive={isActive}
          driver={driver}
          strategy={pitCall}
          simulation={simulation}
          onRequestRun={onRequestSimulation}
        />
      ),
    },
    {
      id: 'result',
      label: 'Result: hypothetical vs actual',
      content: ({ isActive }) => (
        <ResultScene
          isActive={isActive}
          race={race}
          driver={driver}
          strategy={pitCall}
          simulation={simulation}
          onRequestRun={onRequestSimulation}
        />
      ),
    },
  ]
}

export default function LandingPage() {
  // Both selections are owned here, not in scene 1 — scenes 2 onward read them.
  const [selectedRace, setSelectedRace] = useState(null)
  const [selectedDriverId, setSelectedDriverId] = useState(null)

  // The race detail carries the driver list (scene 1), the actual stops (scene 2) and the
  // race length (scene 3), so it's fetched once, here.
  const raceDetail = useApiResource(
    selectedRace && { season: selectedRace.season, round: selectedRace.round },
    loadRaceDetail,
  )
  const race = raceDetail.status === 'ready' ? raceDetail.data : null
  const driver = race?.drivers.find((d) => d.driver_id === selectedDriverId) ?? null

  const driverLaps = useApiResource(
    race && driver && { season: race.season, round: race.round, driverId: driver.driver_id },
    loadDriverLaps,
  )

  // The hypothetical call: scene 3 edits it, scenes 4 and 5 send and read it back. The
  // lap is reset whenever a driver is picked (see `selectDriver`); the compound can't
  // come from the race — no data source publishes what the car fitted — so it starts on
  // the picker's own default.
  const [pitCall, setPitCall] = useState({ lap: 1, compound: DEFAULT_HYPOTHETICAL_COMPOUND })
  const changePitCall = (patch) => setPitCall((current) => ({ ...current, ...patch }))

  // The simulate request is only sent when scene 4 or 5 comes on screen, not on every
  // slider tick in scene 3 — so the request in flight (or settled) can lag the current
  // call. It only counts as this call's result while the two still match.
  const [requestedSimulation, setRequestedSimulation] = useState(null)
  const currentSimulation =
    race && driver
      ? {
          season: race.season,
          round: race.round,
          driverId: driver.driver_id,
          strategy: buildHypotheticalStrategy(driver, pitCall),
          numSimulations: MONTE_CARLO_RUNS,
        }
      : null
  const simulationResource = useApiResource(requestedSimulation, loadSimulation)
  const isSimulationCurrent =
    currentSimulation != null &&
    JSON.stringify(requestedSimulation) === JSON.stringify(currentSimulation)
  const simulation = isSimulationCurrent
    ? simulationResource
    : { ...simulationResource, status: 'idle', data: null, error: null }

  // Idempotent, so scenes can call it from an effect whenever they're on screen.
  const requestSimulation = () => {
    if (currentSimulation && !isSimulationCurrent) setRequestedSimulation(currentSimulation)
  }

  const selectRace = (nextRace) => {
    setSelectedRace(nextRace)
    setSelectedDriverId(null)
  }

  const selectDriver = (driverId) => {
    const picked = race?.drivers.find((d) => d.driver_id === driverId)
    if (!picked) return
    setSelectedDriverId(driverId)
    changePitCall({ lap: initialPitLap(picked, race.total_laps) })
  }

  const scenes = buildScenes({
    selectedRace,
    onSelectRace: selectRace,
    raceDetail,
    race,
    driver,
    onSelectDriver: selectDriver,
    driverLaps,
    pitCall,
    onChangePitCall: changePitCall,
    simulation,
    onRequestSimulation: requestSimulation,
  })

  const tints = buildTints({ driver, pitCall, simulation })

  return (
    // `isolate`: the story's backdrop sits at a negative z-index behind the hero, the
    // scenes and the footer, and this is the stacking context it sits in — without it,
    // this background would paint over it.
    <main className="isolate bg-neutral-950 text-neutral-100">
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
        <p className="mt-14 text-[0.65rem] tracking-[0.3em] text-neutral-400 uppercase">
          Scroll
        </p>
      </section>

      <ScrollStory
        id="story"
        scenes={scenes}
        backdrop={(stage) => (
          <StoryBackdrop {...stage} tints={tints} circuitId={race?.circuit_id} />
        )}
      />

      <section className="safe-px flex h-[60svh] items-center justify-center [--pad-x:1.5rem] pb-[env(safe-area-inset-bottom)]">
        <p className="text-sm text-neutral-400">End of story placeholder</p>
      </section>
    </main>
  )
}
