import { useEffect } from 'react'
import SceneFrame from './SceneFrame'
import PickFirst from './PickFirst'
import PositionChart from './PositionChart'
import RequestError from './RequestError'
import { isRetryable } from '../../lib/api'
import {
  MONTE_CARLO_RUNS,
  buildHypotheticalStrategy,
  compoundById,
  formatRaceTime,
  simulationErrorMessage,
} from '../../lib/raceData'

/** The finish position the most runs ended in, with its share of the runs. */
function likeliestFinish(distribution) {
  const entries = Object.entries(distribution)
  const total = entries.reduce((sum, [, count]) => sum + count, 0)
  const [position, count] = entries.reduce(
    (best, entry) => (entry[1] > best[1] ? entry : best),
    ['0', 0],
  )
  return { position: Number(position), share: total ? count / total : 0 }
}

/**
 * The headline, taken from the response's own `delta_vs_actual_seconds` (mean simulated
 * time minus the real race time). That's null when the driver has no race time — a
 * retirement — so it falls back to comparing finishing positions.
 */
function headline(result, driver) {
  const delta = result.simulated.delta_vs_actual_seconds
  if (delta != null) {
    const rounded = Number(delta.toFixed(1))
    return {
      label: `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}s ${rounded > 0 ? 'slower' : 'faster'}`,
      tone: rounded > 0 ? 'text-red-400' : 'text-emerald-400',
    }
  }

  const { position } = likeliestFinish(result.simulated.finish_position_distribution)
  return {
    label: `Likeliest finish P${position}`,
    tone: 'text-neutral-100',
    note: `${driver.driver_name} has no race time on record (${
      driver.actual_status || 'did not finish'
    }), so positions are compared instead of time.`,
  }
}

/** A tile for one side of the comparison. */
function Side({ label, accent, time, timeNote, finish, finishNote }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4 text-left sm:p-5">
      <p className="text-[0.65rem] tracking-[0.2em] uppercase" style={{ color: accent }}>
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold text-neutral-100 tabular-nums">{finish}</p>
      <p className="text-xs text-neutral-500">{finishNote}</p>
      <p className="mt-2 text-sm text-neutral-300 tabular-nums">{time}</p>
      <p className="text-xs text-neutral-500">{timeNote}</p>
    </div>
  )
}

/**
 * Scene 5 — the real simulation result against the real race.
 *
 * Everything here is read off the `POST /api/simulate` response for the current call:
 * the delta, both race times, the finish distribution and the lap-by-lap position
 * chart. The API models positions and totals, not individual lap times, so the chart
 * compares track position — P1 at the top — rather than pace.
 *
 * Coming on screen also requests the run, in case the story was scrolled past scene 4
 * too fast for it to go active.
 */
export default function ResultScene({
  isActive,
  race,
  driver,
  strategy,
  simulation,
  onRequestRun,
}) {
  useEffect(() => {
    if (isActive) onRequestRun()
  }, [isActive, onRequestRun])

  const frame = (content) => (
    <SceneFrame
      step={5}
      title="Hypothetical vs. actual"
      subtitle="Where the two races diverge, and the lap it stopped being close."
    >
      {content}
    </SceneFrame>
  )

  if (!race || !driver) return frame(<PickFirst />)

  if (simulation.status === 'error') {
    const { error } = simulation
    return frame(
      <div className="mx-auto max-w-2xl rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5 sm:p-7">
        <RequestError
          message={simulationErrorMessage(error)}
          onRetry={isRetryable(error) ? simulation.retry : undefined}
        />
      </div>,
    )
  }

  if (simulation.status !== 'ready') {
    return frame(<PickFirst>Waiting on the simulation…</PickFirst>)
  }

  const result = simulation.data
  const { label, tone, note } = headline(result, driver)
  const likeliest = likeliestFinish(result.simulated.finish_position_distribution)
  const hypotheticalStops = buildHypotheticalStrategy(driver, strategy)
  const actualFirstStop = driver.actual_pit_stops[0]
  const rows = result.lap_by_lap.map((row) => ({
    lap: row.lap,
    hypothetical_position: row.hypothetical_position || null,
    actual_position: row.actual_position || null,
  }))
  const compound = compoundById(strategy.compound)

  return frame(
    <div className="mx-auto max-w-3xl">
      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
        <Side
          label="Actual"
          accent="#a3a3a3"
          finish={
            /^\d+$/.test(driver.actual_position_text)
              ? `P${driver.actual_position_text}`
              : driver.actual_status
          }
          finishNote="Official classification"
          time={
            result.baseline_time_seconds != null
              ? formatRaceTime(result.baseline_time_seconds)
              : 'No race time'
          }
          timeNote={driver.actual_status}
        />
        <Side
          label="Your call"
          accent="#ef4444"
          finish={`P${likeliest.position}`}
          finishNote={`Likeliest finish · ${Math.round(likeliest.share * 100)}% of ${MONTE_CARLO_RUNS} runs`}
          time={formatRaceTime(result.simulated.mean_time_seconds)}
          timeNote={`Mean · median ${formatRaceTime(result.simulated.median_time_seconds)}`}
        />
      </div>

      <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4 sm:mt-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-left">
          <p className="text-[0.65rem] tracking-[0.2em] text-neutral-500 uppercase">
            Track position, lap by lap
          </p>
          <p className="flex items-center gap-3 text-[0.7rem] text-neutral-500">
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded-full bg-red-500" /> Your call
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded-full bg-neutral-400" /> Actual
            </span>
          </p>
        </div>
        <div className="mt-2 h-40 w-full sm:h-48">
          <PositionChart
            rows={rows}
            actualStops={driver.actual_pit_stops}
            hypotheticalStops={hypotheticalStops}
            ariaLabel={`Track position per lap for ${driver.driver_name}: the simulated strategy against the real race.`}
          />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1">
        <p className={`text-2xl font-semibold tabular-nums sm:text-3xl ${tone}`}>{label}</p>
        <p className="text-sm text-neutral-500">
          over {rows.length} laps — {compound.label.toLowerCase()}s on lap {strategy.lap}{' '}
          {!actualFirstStop
            ? 'instead of not stopping'
            : actualFirstStop.lap === strategy.lap
              ? 'on the lap they really stopped'
              : `instead of stopping on lap ${actualFirstStop.lap}`}
        </p>
      </div>
      {note && <p className="mt-2 text-xs text-neutral-500">{note}</p>}
    </div>,
  )
}
