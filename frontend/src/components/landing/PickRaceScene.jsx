import { useEffect, useState } from 'react'
import SceneFrame from './SceneFrame'
import CircuitBackdrop from './CircuitBackdrop'
import TrackOutline from './TrackOutline'
import { fetchRaces } from '../../lib/api'

/**
 * Formats a race's `YYYY-MM-DD` date for display.
 *
 * Parsed into local parts rather than handed to `new Date(isoDate)`: the Date
 * constructor reads a bare ISO date as UTC midnight, which renders as the previous
 * day everywhere west of UTC.
 */
function formatDate(isoDate) {
  const [year, month, day] = String(isoDate).split('-').map(Number)
  if (!year || !month || !day) return isoDate

  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Scene 1 — the race selector, backed by GET /api/races.
 *
 * Fetching lives here, but the chosen race is lifted to the parent: later scenes are
 * driven by the same selection, so it can't be owned by this scene.
 *
 * The circuit art around the list is decorative only — <CircuitBackdrop> fills the stage
 * behind the scene, <TrackOutline> sits beside the list. Both fade with the scene.
 */
export default function PickRaceScene({ selectedRace, onSelectRace }) {
  // One object rather than three pieces of state: status, data and error always change
  // together, and it keeps the effect free of synchronous setState calls.
  const [request, setRequest] = useState({
    status: 'loading',
    races: [],
    error: null,
  })
  // Bumped by the retry button to re-run the fetch effect.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    fetchRaces({ signal: controller.signal })
      .then((races) => setRequest({ status: 'ready', races, error: null }))
      .catch((cause) => {
        // StrictMode's double-mount aborts the first request; that's not a failure.
        if (cause.name === 'AbortError') return
        setRequest({ status: 'error', races: [], error: cause.message })
      })

    return () => controller.abort()
  }, [attempt])

  const retry = () => {
    setRequest({ status: 'loading', races: [], error: null })
    setAttempt((n) => n + 1)
  }

  const { status, races, error } = request

  return (
    <>
      <CircuitBackdrop />

      {/* z-10: the backdrop is positioned, so without it the art would paint over this. */}
      <div className="relative z-10 w-full">
        <SceneFrame
          step={1}
          title="Pick a race"
          subtitle="Any Grand Prix on record. The one you still argue about."
        >
          <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-stretch">
            {/* Art comes after the list on narrow screens — the list is the job. */}
            <div className="order-2 flex flex-col rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 lg:order-1">
              <TrackOutline
                label={selectedRace?.circuit_name}
                className="h-24 w-full sm:h-28 lg:h-auto lg:min-h-0 lg:flex-1"
              />
              <p className="mt-2 truncate text-left text-[0.65rem] tracking-[0.2em] text-neutral-500 uppercase">
                {selectedRace?.circuit_name ?? 'Any circuit on record'}
              </p>
            </div>

            <div className="order-1 w-full rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5 sm:p-6 lg:order-2">
              {status === 'loading' && (
                <p className="py-8 text-sm text-neutral-500">Loading races…</p>
              )}

              {status === 'error' && (
                <div className="py-8">
                  <p className="text-sm text-red-400">{error}</p>
                  <button
                    type="button"
                    onClick={retry}
                    className="mt-4 rounded-full border border-neutral-700 px-4 py-1.5 text-xs tracking-wider text-neutral-300 uppercase hover:border-neutral-500"
                  >
                    Try again
                  </button>
                </div>
              )}

              {status === 'ready' && races.length === 0 && (
                <p className="py-8 text-sm text-neutral-500">No races cached yet.</p>
              )}

              {status === 'ready' && races.length > 0 && (
                <ul className="max-h-60 space-y-1.5 overflow-y-auto text-left [scrollbar-color:#404040_transparent] [scrollbar-width:thin] sm:max-h-72">
                  {races.map((race) => {
                    const isSelected =
                      selectedRace?.season === race.season &&
                      selectedRace?.round === race.round

                    return (
                      <li key={`${race.season}-${race.round}`}>
                        <button
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => onSelectRace(race)}
                          className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
                            isSelected
                              ? 'border-red-500 bg-red-500/10'
                              : 'border-neutral-800 hover:border-neutral-600'
                          }`}
                        >
                          <span className="flex items-baseline justify-between gap-3">
                            <span className="text-sm font-medium text-neutral-100">
                              {race.race_name}
                            </span>
                            <span className="shrink-0 text-xs text-neutral-500 tabular-nums">
                              {race.season} · R{race.round}
                            </span>
                          </span>
                          <span className="mt-1 flex items-baseline justify-between gap-3">
                            <span className="text-xs text-neutral-500">
                              {race.circuit_name}
                            </span>
                            <span className="shrink-0 text-xs text-neutral-600">
                              {formatDate(race.date)}
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}

              <p className="mt-4 text-xs tracking-[0.2em] text-neutral-600 uppercase">
                {selectedRace
                  ? `Selected · ${selectedRace.race_name} ${selectedRace.season}`
                  : 'Select a race to continue'}
              </p>
            </div>
          </div>
        </SceneFrame>
      </div>
    </>
  )
}
