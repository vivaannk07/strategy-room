import { useEffect, useState } from 'react'
import SceneFrame from './SceneFrame'
import CircuitBackdrop from './CircuitBackdrop'
import TrackOutline from './TrackOutline'
import RequestError from './RequestError'
import { fetchRaces, isRetryable } from '../../lib/api'
import { formatStopCount } from '../../lib/raceData'

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

/** `P3` for a classified finish; the status (`Retired`, `Disqualified`…) otherwise. */
function finishLabel(driver) {
  return /^\d+$/.test(driver.actual_position_text)
    ? `P${driver.actual_position_text}`
    : driver.actual_status || driver.actual_position_text
}

/**
 * The second half of scene 1: who took part in the picked race, from its race detail.
 * Stands in for the race list inside the same card once a race is picked.
 */
function DriverPicker({ race, raceDetail, selectedDriverId, onSelectDriver, onChangeRace }) {
  const drivers = raceDetail.data?.drivers ?? []
  const selectedDriver = drivers.find((driver) => driver.driver_id === selectedDriverId)

  return (
    <>
      <div className="flex items-baseline justify-between gap-3 text-left">
        <p className="min-w-0 truncate text-sm font-medium text-neutral-100">
          {race.race_name}{' '}
          <span className="text-xs text-neutral-400 tabular-nums">
            {race.season} · R{race.round}
          </span>
        </p>
        <button
          type="button"
          onClick={onChangeRace}
          // -mr-2 pulls the widened hit area back out to the card edge so the
          // label still lines up with the heading beside it.
          className="tap-target -mr-2 flex shrink-0 items-center justify-end px-2 text-xs tracking-wider text-neutral-400 uppercase hover:text-neutral-200 active:text-neutral-200"
        >
          Change race
        </button>
      </div>

      {raceDetail.status === 'loading' && (
        <p className="py-8 text-sm text-neutral-400">
          Loading drivers… the first time a race is opened it's fetched from Jolpica, so
          this can take a while.
        </p>
      )}

      {raceDetail.status === 'error' && (
        <RequestError
          message={raceDetail.error.message}
          onRetry={isRetryable(raceDetail.error) ? raceDetail.retry : undefined}
        />
      )}

      {raceDetail.status === 'ready' && drivers.length === 0 && (
        <p className="py-8 text-sm text-neutral-400">No drivers are recorded for this race.</p>
      )}

      {raceDetail.status === 'ready' && drivers.length > 0 && (
        <ul className="mt-3 max-h-56 space-y-1.5 overflow-y-auto text-left [scrollbar-color:#404040_transparent] [scrollbar-width:thin] sm:max-h-64">
          {drivers.map((driver) => {
            const isSelected = driver.driver_id === selectedDriverId

            return (
              <li key={driver.driver_id}>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onSelectDriver(driver.driver_id)}
                  className={`tap-target flex w-full items-baseline gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                    isSelected
                      ? 'border-red-500 bg-red-500/10'
                      : 'border-neutral-800 hover:border-neutral-600 active:border-neutral-600 active:bg-neutral-800/40'
                  }`}
                >
                  <span className="w-12 shrink-0 truncate text-xs text-neutral-400 tabular-nums">
                    {finishLabel(driver)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-neutral-100">
                    {driver.driver_name}
                    <span className="ml-2 text-xs text-neutral-400">
                      {driver.constructor_name}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-neutral-400 tabular-nums">
                    {formatStopCount(driver.actual_pit_stops.length)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <p className="mt-4 text-xs tracking-[0.2em] text-neutral-400 uppercase">
        {selectedDriver
          ? `Selected · ${selectedDriver.driver_name}`
          : 'Select a driver to continue'}
      </p>
    </>
  )
}

/**
 * Scene 1 — the race selector, backed by GET /api/races, then the driver selector for
 * the picked race.
 *
 * The race list is fetched here. The race detail (which carries the driver list) is
 * fetched by the parent instead, because scenes 2–5 read the same response; this scene
 * only renders it. Both selections are lifted for the same reason.
 *
 * The circuit art around the list is decorative only — <CircuitBackdrop> fills the stage
 * behind the scene, <TrackOutline> sits beside the list. Both fade with the scene.
 *
 * @param {object} raceDetail  `useApiResource` state for GET /api/races/{season}/{round}.
 */
export default function PickRaceScene({
  selectedRace,
  onSelectRace,
  raceDetail,
  selectedDriverId,
  onSelectDriver,
}) {
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
  // The race list's state lives in this component, so hiding the list while the driver
  // picker shows keeps it — "Change race" brings it straight back without a refetch.
  const showRaces = !selectedRace

  return (
    <>
      <CircuitBackdrop />

      {/* z-10: the backdrop is positioned, so without it the art would paint over this. */}
      <div className="relative z-10 w-full">
        <SceneFrame
          step={1}
          title="Pick a race"
          subtitle="Any Grand Prix on record, then the driver whose call you'd change."
        >
          <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-stretch">
            {/* Art comes after the list on narrow screens — the list is the job. */}
            <div className="order-2 flex flex-col rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 lg:order-1">
              <TrackOutline
                label={selectedRace?.circuit_name}
                className="h-24 w-full sm:h-28 lg:h-auto lg:min-h-0 lg:flex-1"
              />
              <p className="mt-2 truncate text-left text-[0.65rem] tracking-[0.2em] text-neutral-400 uppercase">
                {selectedRace?.circuit_name ?? 'Any circuit on record'}
              </p>
            </div>

            {/* min-w-0: a grid item won't shrink below its content by default, and the
                driver rows' truncating names would otherwise push the card off-screen. */}
            <div className="order-1 w-full min-w-0 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5 sm:p-6 lg:order-2">
              {selectedRace && (
                <DriverPicker
                  race={selectedRace}
                  raceDetail={raceDetail}
                  selectedDriverId={selectedDriverId}
                  onSelectDriver={onSelectDriver}
                  onChangeRace={() => onSelectRace(null)}
                />
              )}

              {showRaces && status === 'loading' && (
                <p className="py-8 text-sm text-neutral-400">Loading races…</p>
              )}

              {showRaces && status === 'error' && (
                <RequestError message={error} onRetry={retry} />
              )}

              {showRaces && status === 'ready' && races.length === 0 && (
                <p className="py-8 text-sm text-neutral-400">No races cached yet.</p>
              )}

              {showRaces && status === 'ready' && races.length > 0 && (
                <ul className="max-h-60 space-y-1.5 overflow-y-auto text-left [scrollbar-color:#404040_transparent] [scrollbar-width:thin] sm:max-h-72">
                  {races.map((race) => (
                    <li key={`${race.season}-${race.round}`}>
                      <button
                        type="button"
                        onClick={() => onSelectRace(race)}
                        className="tap-target w-full rounded-lg border border-neutral-800 px-4 py-3 text-left transition-colors hover:border-neutral-600 active:border-neutral-600 active:bg-neutral-800/40"
                      >
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="text-sm font-medium text-neutral-100">
                            {race.race_name}
                          </span>
                          <span className="shrink-0 text-xs text-neutral-400 tabular-nums">
                            {race.season} · R{race.round}
                          </span>
                        </span>
                        <span className="mt-1 flex items-baseline justify-between gap-3">
                          <span className="text-xs text-neutral-400">
                            {race.circuit_name}
                          </span>
                          <span className="shrink-0 text-xs text-neutral-400">
                            {formatDate(race.date)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {showRaces && (
                <p className="mt-4 text-xs tracking-[0.2em] text-neutral-400 uppercase">
                  Select a race to continue
                </p>
              )}
            </div>
          </div>
        </SceneFrame>
      </div>
    </>
  )
}
