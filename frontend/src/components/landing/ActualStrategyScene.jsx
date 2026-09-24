import SceneFrame from './SceneFrame'
import LapPaceChart from './LapPaceChart'
import PickFirst from './PickFirst'
import RequestError from './RequestError'
import StintBar from './StintBar'
import { isRetryable } from '../../lib/api'
import {
  buildPaceSeries,
  buildStints,
  driverLastLap,
  fastestLap,
  formatLapTime,
} from '../../lib/raceData'

/**
 * Scene 2 — the driver's race as it ran: recorded lap times with the real stops marked
 * on the lap axis.
 *
 * Stops come from the race detail and are labelled with lap and pit-lane time and
 * nothing else, and the stint bar is neutral: Jolpica publishes no tire data, so there is
 * no compound to put on an actual stint.
 *
 * @param {object|null} race    GET /api/races/{season}/{round} response.
 * @param {object|null} driver  One of `race.drivers`.
 * @param {object} laps  `useApiResource` state for the driver's laps.
 */
export default function ActualStrategyScene({ race, driver, laps }) {
  const frame = (content) => (
    <SceneFrame
      step={2}
      title="Here's what they actually did"
      subtitle="Every stint, every stop, exactly as it happened on the day."
    >
      {content}
    </SceneFrame>
  )

  if (!race || !driver) return frame(<PickFirst />)

  const stops = driver.actual_pit_stops
  const stints = buildStints(stops, driverLastLap(driver, race.total_laps))
  const lapRows = laps.status === 'ready' ? laps.data : []
  const fastest = fastestLap(lapRows)
  const stopList = stops.map((stop) => stop.lap).join(', ')
  // One column per stop (or the single "None" cell), plus the fastest lap once known.
  const columns = Math.max(stops.length, 1) + (fastest ? 1 : 0)

  return frame(
    <div className="mx-auto max-w-2xl rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5 sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-left">
        <p className="text-sm font-medium text-neutral-100">
          {driver.driver_name}
          <span className="ml-2 text-xs text-neutral-400">{driver.constructor_name}</span>
        </p>
        <p className="text-xs text-neutral-400">
          {race.race_name} {race.season} · {race.total_laps} laps
        </p>
      </div>

      <div className="mt-5">
        <StintBar stints={stints} />
      </div>

      <div className="mt-6 h-44 w-full sm:h-56">
        {laps.status === 'loading' && (
          <p className="py-8 text-sm text-neutral-400">Loading lap times…</p>
        )}

        {laps.status === 'error' && (
          <RequestError
            message={laps.error.message}
            onRetry={isRetryable(laps.error) ? laps.retry : undefined}
          />
        )}

        {laps.status === 'ready' && lapRows.length === 0 && (
          <p className="py-8 text-sm text-neutral-400">
            No lap timing is recorded for {driver.driver_name} in this race.
          </p>
        )}

        {laps.status === 'ready' && lapRows.length > 0 && (
          <LapPaceChart
            id="actual"
            laps={buildPaceSeries(lapRows, stops)}
            stops={stops}
            ariaLabel={`Lap times for ${driver.driver_name} across ${lapRows.length} laps${
              stops.length ? `, with pit stops on laps ${stopList}` : ', with no pit stops'
            }.`}
          />
        )}
      </div>

      <dl
        className="mt-5 grid gap-3 border-t border-neutral-800 pt-4 text-left"
        // One column per item. Inline because Tailwind can't see a class name assembled
        // at runtime.
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {/*
          Lap and pit-lane time only. The compound the car came out on isn't published
          for any real stop, so the marker doesn't claim one.
        */}
        {stops.map((stop) => (
          <div key={stop.stop}>
            <dt className="text-[0.65rem] tracking-wider text-neutral-400 uppercase">
              Stop {stop.stop}
            </dt>
            <dd className="mt-1 text-sm text-neutral-100 tabular-nums">Lap {stop.lap}</dd>
            <dd className="mt-0.5 text-xs text-neutral-400 tabular-nums">
              {stop.duration_seconds.toFixed(1)}s in the pit lane
            </dd>
          </div>
        ))}
        {stops.length === 0 && (
          <div>
            <dt className="text-[0.65rem] tracking-wider text-neutral-400 uppercase">
              Pit stops
            </dt>
            <dd className="mt-1 text-sm text-neutral-100">None</dd>
            <dd className="mt-0.5 text-xs text-neutral-400">
              {driver.actual_status || 'Ran the race without stopping'}
            </dd>
          </div>
        )}
        {fastest && (
          <div>
            <dt className="text-[0.65rem] tracking-wider text-neutral-400 uppercase">
              Fastest lap
            </dt>
            <dd className="mt-1 text-sm text-neutral-100 tabular-nums">
              {formatLapTime(fastest.lap_time_seconds, 3)}
            </dd>
            <dd className="mt-0.5 text-xs text-neutral-400">Lap {fastest.lap}</dd>
          </div>
        )}
      </dl>
    </div>,
  )
}
