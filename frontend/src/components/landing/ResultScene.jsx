import { useEffect } from 'react'
import SceneFrame from './SceneFrame'
import PickFirst from './PickFirst'
import PositionChart, { ACTUAL_COLOR, HYPOTHETICAL_COLOR } from './PositionChart'
import RequestError from './RequestError'
import { isRetryable } from '../../lib/api'
import {
  MONTE_CARLO_RUNS,
  buildHypotheticalStrategy,
  compoundById,
  formatRaceTime,
  likeliestFinish,
  simulationErrorMessage,
} from '../../lib/raceData'

// Ties the two position charts together: Recharts puts the cursor and tooltip on the
// same lap in both panels whichever one the pointer is over.
const POSITION_SYNC_ID = 'result-position'

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

/**
 * Both rows of this scene are two columns at every width — the comparison is the
 * point, so a phone gets the same side-by-side reading as a desktop rather than a
 * stacked version of it. What changes with the screen is the scale: padding, type
 * and chart height all step down together, which is what keeps all four panels
 * inside the pinned stage at 390×844 (they overflowed it by 125px when the rows
 * stacked on mobile).
 */
const PANEL = 'rounded-2xl border border-neutral-800 bg-neutral-900 p-3 text-left sm:p-5'
const PANEL_LABEL = 'truncate text-[0.6rem] tracking-[0.15em] uppercase sm:text-[0.65rem] sm:tracking-[0.2em]'

/** A tile for one side of the comparison. */
function Side({ label, accent, time, timeNote, finish, finishNote }) {
  return (
    <div className={PANEL}>
      <p className={PANEL_LABEL} style={{ color: accent }}>
        {label}
      </p>
      <p className="mt-1.5 text-lg font-semibold text-neutral-100 tabular-nums sm:mt-2 sm:text-xl">
        {finish}
      </p>
      <p className="text-[0.65rem] text-neutral-400 sm:text-xs">{finishNote}</p>
      <p className="mt-1.5 text-xs text-neutral-300 tabular-nums sm:mt-2 sm:text-sm">{time}</p>
      <p className="text-[0.65rem] text-neutral-400 sm:text-xs">{timeNote}</p>
    </div>
  )
}

/** One side's chart, headed like its stat card above it. */
function ChartPanel({ label, accent, children }) {
  return (
    <div className={PANEL}>
      <p className={PANEL_LABEL} style={{ color: accent }}>
        {label}
      </p>
      <div className="mt-1.5 h-28 w-full sm:mt-2 sm:h-44">{children}</div>
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
      <div className="mx-auto max-w-2xl rounded-2xl border border-neutral-800 bg-neutral-900 p-5 sm:p-7">
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
      <div className="grid grid-cols-2 gap-2 sm:gap-4">
        <Side
          label="Actual"
          accent={ACTUAL_COLOR}
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
          accent={HYPOTHETICAL_COLOR}
          finish={`P${likeliest.position}`}
          finishNote={`Likeliest finish · ${Math.round(likeliest.share * 100)}% of ${MONTE_CARLO_RUNS} runs`}
          time={formatRaceTime(result.simulated.mean_time_seconds)}
          timeNote={`Mean · median ${formatRaceTime(result.simulated.median_time_seconds)}`}
        />
      </div>

      <p className="mt-3 text-left text-[0.6rem] tracking-[0.15em] text-neutral-400 uppercase sm:mt-5 sm:text-[0.65rem] sm:tracking-[0.2em]">
        Track position, lap by lap
      </p>
      <div className="mt-1.5 grid grid-cols-2 gap-2 sm:mt-2 sm:gap-4">
        <ChartPanel label="Actual" accent={ACTUAL_COLOR}>
          <PositionChart
            rows={rows}
            series="actual"
            stops={driver.actual_pit_stops}
            syncId={POSITION_SYNC_ID}
            ariaLabel={`Track position per lap for ${driver.driver_name} in the real race.`}
          />
        </ChartPanel>
        <ChartPanel label="Your call" accent={HYPOTHETICAL_COLOR}>
          <PositionChart
            rows={rows}
            series="hypothetical"
            stops={hypotheticalStops}
            syncId={POSITION_SYNC_ID}
            ariaLabel={`Track position per lap for ${driver.driver_name} under the simulated strategy.`}
          />
        </ChartPanel>
      </div>

      <div className="mt-4 flex flex-wrap items-baseline justify-center gap-x-3 gap-y-0.5 sm:mt-5 sm:gap-y-1">
        <p className={`text-xl font-semibold tabular-nums sm:text-3xl ${tone}`}>{label}</p>
        <p className="text-xs text-neutral-400 sm:text-sm">
          over {rows.length} laps — {compound.label.toLowerCase()}s on lap {strategy.lap}{' '}
          {!actualFirstStop
            ? 'instead of not stopping'
            : actualFirstStop.lap === strategy.lap
              ? 'on the lap they really stopped'
              : `instead of stopping on lap ${actualFirstStop.lap}`}
        </p>
      </div>
      {note && <p className="mt-2 text-[0.65rem] text-neutral-400 sm:text-xs">{note}</p>}
    </div>,
  )
}
