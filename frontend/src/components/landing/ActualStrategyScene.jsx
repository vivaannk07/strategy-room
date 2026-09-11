import SceneFrame from './SceneFrame'
import LapPaceChart from './LapPaceChart'
import StintBar from './StintBar'
import {
  ACTUAL_LAPS,
  ACTUAL_PACE_COMPOUNDS,
  ACTUAL_STRATEGY,
  MOCK_RACE,
  buildStints,
  formatLapTime,
} from '../../lib/mockRaceData'

// Same synthesis compounds `ACTUAL_LAPS` is built with, so the two agree about this race.
const STINTS = buildStints(ACTUAL_STRATEGY, { paceCompounds: ACTUAL_PACE_COMPOUNDS })

/** Quickest lap of the race, ignoring the laps a stop was served on. */
const FASTEST_LAP = ACTUAL_LAPS.filter((lap) => !lap.is_pit_lap).reduce((best, lap) =>
  lap.pace_seconds < best.pace_seconds ? lap : best,
)

/**
 * Scene 2 — the driver's race as it ran: lap pace across the race with the two stops
 * marked on the lap axis.
 *
 * Reads from `mockRaceData` only. Stops are labelled with lap and pit-lane time and
 * nothing else, and the stint bar is neutral: Jolpica publishes no tire data, so there is
 * no compound to put on an actual stint. Next pass this takes the selected race's real
 * laps and stops, which arrive in exactly that shape.
 */
export default function ActualStrategyScene() {
  return (
    <SceneFrame
      step={2}
      title="Here's what they actually did"
      subtitle="Every stint, every stop, exactly as it happened on the day."
    >
      <div className="mx-auto max-w-2xl rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5 sm:p-7">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-left">
          <p className="text-sm font-medium text-neutral-100">
            {MOCK_RACE.driver_name}
            <span className="ml-2 text-xs text-neutral-500">
              {MOCK_RACE.constructor_name}
            </span>
          </p>
          <p className="text-xs text-neutral-500">
            {MOCK_RACE.race_name} {MOCK_RACE.season} · {MOCK_RACE.total_laps} laps
          </p>
        </div>

        <div className="mt-5">
          <StintBar stints={STINTS} />
        </div>

        <div className="mt-6 h-44 w-full sm:h-56">
          <LapPaceChart
            id="actual"
            laps={ACTUAL_LAPS}
            strategy={ACTUAL_STRATEGY}
            ariaLabel={`Lap pace for ${MOCK_RACE.driver_name} across ${MOCK_RACE.total_laps} laps, with pit stops on laps ${ACTUAL_STRATEGY.map((stop) => stop.lap).join(' and ')}.`}
          />
        </div>

        <dl
          className="mt-5 grid gap-3 border-t border-neutral-800 pt-4 text-left"
          // One column per stop plus the fastest lap. Inline because Tailwind can't see a
          // class name assembled at runtime.
          style={{
            gridTemplateColumns: `repeat(${ACTUAL_STRATEGY.length + 1}, minmax(0, 1fr))`,
          }}
        >
          {/*
            Lap and pit-lane time only. The compound the car came out on isn't published
            for any real stop, so the marker doesn't claim one.
          */}
          {ACTUAL_STRATEGY.map((stop) => (
            <div key={stop.stop}>
              <dt className="text-[0.65rem] tracking-wider text-neutral-500 uppercase">
                Stop {stop.stop}
              </dt>
              <dd className="mt-1 text-sm text-neutral-100 tabular-nums">
                Lap {stop.lap}
              </dd>
              <dd className="mt-0.5 text-xs text-neutral-500 tabular-nums">
                {stop.duration_seconds.toFixed(1)}s in the pit lane
              </dd>
            </div>
          ))}
          <div>
            <dt className="text-[0.65rem] tracking-wider text-neutral-500 uppercase">
              Fastest lap
            </dt>
            <dd className="mt-1 text-sm text-neutral-100 tabular-nums">
              {formatLapTime(FASTEST_LAP.pace_seconds, 3)}
            </dd>
            <dd className="mt-0.5 text-xs text-neutral-500">Lap {FASTEST_LAP.lap}</dd>
          </div>
        </dl>
      </div>
    </SceneFrame>
  )
}
