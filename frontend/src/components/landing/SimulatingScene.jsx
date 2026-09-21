import { useEffect } from 'react'
import { motion, useReducedMotion, useTransform } from 'framer-motion'
import SceneFrame from './SceneFrame'
import PickFirst from './PickFirst'
import RequestError from './RequestError'
import { isRetryable } from '../../lib/api'
import {
  GENERIC_DEGRADATION_PER_LAP,
  MONTE_CARLO_RUNS,
  buildDegradationSeries,
  compoundById,
  simulationErrorMessage,
} from '../../lib/raceData'

const MAX_TIRE_AGE = 28

/**
 * The plot's own coordinate space. Its aspect ratio is the drawn one — the <svg> fills
 * the card's width and takes its height from this box, so nothing is letterboxed. Text
 * lives in HTML around the plot rather than inside it, so labels stay legible at 390px
 * instead of scaling down with the drawing.
 */
const VIEW = { width: 480, height: 168, padX: 4, padTop: 10, padBottom: 10 }

/** Degradation points → an SVG polyline, scaled into the viewBox between `min` and `max`. */
function toPath(points, [min, max]) {
  const plotWidth = VIEW.width - VIEW.padX * 2
  const plotHeight = VIEW.height - VIEW.padTop - VIEW.padBottom

  return points
    .map((point, index) => {
      const x = VIEW.padX + (point.age / MAX_TIRE_AGE) * plotWidth
      const y = VIEW.height - VIEW.padBottom - ((point.delta - min) / (max - min)) * plotHeight
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

/** How far into the scroll each compound's curve draws. Staggered, slowest tyre first. */
function curveWindow(index) {
  return { from: 0.12 + index * 0.06, to: 0.68 + index * 0.06 }
}

/**
 * One compound's curve, drawing itself in across its own slice of the scroll.
 *
 * A component rather than a loop body so each curve owns its own hooks — the three
 * curves are staggered, and staggering inside a `map` would mean conditional hooks.
 */
function DegradationCurve({ series, bounds, progress, index }) {
  const { from, to } = curveWindow(index)
  const pathLength = useTransform(progress, [from, to], [0, 1], { clamp: true })

  return (
    <motion.path
      d={toPath(series.points, bounds)}
      fill="none"
      stroke={series.compound.color}
      strokeWidth="2.5"
      strokeLinecap="round"
      style={{ pathLength }}
    />
  )
}

/** Legend entry that arrives as its curve finishes drawing. */
function CurveKey({ series, progress, index }) {
  const { to } = curveWindow(index)
  const opacity = useTransform(progress, [to - 0.12, to], [0.15, 1], { clamp: true })
  const end = series.points.at(-1).delta

  return (
    <motion.li
      style={{ opacity }}
      className="flex items-center gap-1.5 text-[0.7rem] text-neutral-400 tabular-nums"
    >
      <span
        className="h-0.5 w-4 rounded-full"
        style={{ backgroundColor: series.compound.color }}
      />
      {series.compound.label}
      <span className="text-neutral-600">
        {end >= 0 ? '+' : ''}
        {end.toFixed(1)}s
      </span>
    </motion.li>
  )
}

/**
 * Indeterminate progress: the API reports nothing until the run is done, so a bar that
 * filled would be claiming progress nobody measured. A segment sweeps instead; with
 * reduced motion it holds still and pulses its opacity.
 */
function RunningBar() {
  const reduced = useReducedMotion()

  return (
    <div className="relative h-1 overflow-hidden rounded-full bg-neutral-800">
      <motion.div
        className="absolute inset-y-0 w-2/5 rounded-full bg-red-500"
        initial={reduced ? { x: '75%', opacity: 0.4 } : { x: '-100%' }}
        animate={reduced ? { opacity: [0.4, 1, 0.4] } : { x: '250%' }}
        transition={{ duration: 1.4, ease: 'easeInOut', repeat: Infinity }}
      />
    </div>
  )
}

/**
 * Scene 4 — the Monte Carlo, run for real.
 *
 * Coming on screen sends the current call to `POST /api/simulate` (via `onRequestRun`,
 * which does nothing if this exact call already ran). The degradation curves keep their
 * scroll-driven build-up while the request runs; they draw with the backend's generic
 * rates until the result lands, then with the wear it measured for this race.
 *
 * @param {MotionValue<number>} progress  0→1 across this scene's slice of the story.
 * @param {boolean} isActive  Whether this scene owns the screen.
 * @param {{lap: number, compound: string}} strategy  The call made in scene 3.
 * @param {object} simulation  `useApiResource` state for the simulate request.
 */
export default function SimulatingScene({
  progress,
  isActive,
  driver,
  strategy,
  simulation,
  onRequestRun,
}) {
  useEffect(() => {
    if (isActive) onRequestRun()
  }, [isActive, onRequestRun])

  const paceModel = simulation.status === 'ready' ? simulation.data.pace_model : null
  const series = buildDegradationSeries(
    paceModel?.degradation_per_lap ?? GENERIC_DEGRADATION_PER_LAP,
    MAX_TIRE_AGE,
  )
  const deltas = series.flatMap((s) => s.points.map((point) => point.delta))
  const bounds = [Math.min(0, ...deltas), Math.max(...deltas)]
  const compound = compoundById(strategy.compound)
  const { status, error } = simulation

  return (
    <SceneFrame
      step={4}
      title="Simulating the race"
      subtitle="Five hundred runs, lap by lap, with the safety car rolling the dice each time."
    >
      {!driver ? (
        <PickFirst />
      ) : (
        <div className="mx-auto max-w-2xl rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-left">
            <p className="text-[0.65rem] tracking-[0.2em] text-neutral-500 uppercase">
              Degradation model
            </p>
            <p className="flex items-center gap-1.5 text-xs text-neutral-400">
              Your call
              <span className={`h-1.5 w-1.5 rounded-full ${compound.dot}`} />
              {compound.label} on lap {strategy.lap}
            </p>
          </div>

          <svg
            viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
            role="img"
            aria-label="Tyre degradation against tyre age, for the soft, medium and hard compounds."
            className="mt-3 w-full"
          >
            {/* Baseline and gridlines, so the curves have something to climb away from. */}
            {[0, 0.5, 1].map((fraction) => {
              const y =
                VIEW.height -
                VIEW.padBottom -
                fraction * (VIEW.height - VIEW.padTop - VIEW.padBottom)
              return (
                <line
                  key={fraction}
                  x1={VIEW.padX}
                  x2={VIEW.width - VIEW.padX}
                  y1={y}
                  y2={y}
                  stroke="#262626"
                  strokeWidth="1"
                  strokeDasharray={fraction === 0 ? undefined : '2 4'}
                />
              )
            })}

            {series.map((s, index) => (
              <DegradationCurve
                key={s.compound.id}
                series={s}
                bounds={bounds}
                progress={progress}
                index={index}
              />
            ))}
          </svg>

          <div className="mt-2 flex items-center justify-between text-[0.65rem] tracking-[0.12em] text-neutral-600 uppercase">
            <span>Fresh</span>
            <span>{MAX_TIRE_AGE} laps old</span>
          </div>

          <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1">
            {series.map((s, index) => (
              <CurveKey key={s.compound.id} series={s} progress={progress} index={index} />
            ))}
          </ul>
          <p className="mt-1 text-[0.7rem] text-neutral-600">
            {paceModel
              ? `Wear measured at ${paceModel.degradation_per_lap.toFixed(3)}s/lap for this race`
              : 'Generic wear rates until the run comes back'}
          </p>

          <div className="mt-5">
            {status === 'error' ? (
              <RequestError
                className="py-2"
                message={simulationErrorMessage(error)}
                onRetry={isRetryable(error) ? simulation.retry : undefined}
              />
            ) : status === 'ready' ? (
              <>
                <div className="h-1 rounded-full bg-red-500" />
                <p className="mt-3 text-xs tracking-[0.2em] text-neutral-500 uppercase">
                  {MONTE_CARLO_RUNS.toLocaleString()} runs complete
                </p>
              </>
            ) : (
              <>
                <RunningBar />
                <p className="mt-3 text-xs tracking-[0.2em] text-neutral-500 uppercase">
                  Running {MONTE_CARLO_RUNS.toLocaleString()} simulations…
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </SceneFrame>
  )
}
