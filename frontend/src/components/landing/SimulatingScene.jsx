import { motion, useTransform } from 'framer-motion'
import SceneFrame from './SceneFrame'
import { buildDegradationSeries, compoundById } from '../../lib/mockRaceData'

const MONTE_CARLO_RUNS = 500
const MAX_TIRE_AGE = 28

const SERIES = buildDegradationSeries(MAX_TIRE_AGE)
const MAX_DELTA = Math.max(
  ...SERIES.flatMap((series) => series.points.map((point) => point.delta)),
)

/**
 * The plot's own coordinate space. Its aspect ratio is the drawn one — the <svg> fills
 * the card's width and takes its height from this box, so nothing is letterboxed. Text
 * lives in HTML around the plot rather than inside it, so labels stay legible at 390px
 * instead of scaling down with the drawing.
 */
const VIEW = { width: 480, height: 168, padX: 4, padTop: 10, padBottom: 10 }

/** Degradation points → an SVG polyline, scaled into the viewBox above. */
function toPath(points) {
  const plotWidth = VIEW.width - VIEW.padX * 2
  const plotHeight = VIEW.height - VIEW.padTop - VIEW.padBottom

  return points
    .map((point, index) => {
      const x = VIEW.padX + (point.age / MAX_TIRE_AGE) * plotWidth
      const y = VIEW.height - VIEW.padBottom - (point.delta / MAX_DELTA) * plotHeight
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
function DegradationCurve({ series, progress, index }) {
  const { from, to } = curveWindow(index)
  const pathLength = useTransform(progress, [from, to], [0, 1], { clamp: true })

  return (
    <motion.path
      d={toPath(series.points)}
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
        +{series.points.at(-1).delta.toFixed(1)}s
      </span>
    </motion.li>
  )
}

/**
 * Scene 4 — the Monte Carlo build-up: the degradation curves the sim runs on, drawing
 * themselves in, and the run counter climbing to 500.
 *
 * Driven off the scene's scroll `progress`, the same way <ScrollStory> intends: the
 * animation is scrubbable, so it can't finish before the scene is on screen or replay
 * out of step with it. Nothing here computes anything — the real numbers come from
 * `POST /api/simulate` next pass.
 *
 * @param {MotionValue<number>} progress  0→1 across this scene's slice of the story.
 * @param {{lap: number, compound: string}} strategy  The call made in scene 3.
 */
export default function SimulatingScene({ progress, strategy }) {
  const runs = useTransform(progress, [0.15, 0.85], [0, MONTE_CARLO_RUNS], {
    clamp: true,
  })
  const runsLabel = useTransform(runs, (value) =>
    Math.max(1, Math.round(value)).toLocaleString(),
  )
  const barScale = useTransform(progress, [0.15, 0.85], [0, 1], { clamp: true })
  const compound = compoundById(strategy.compound)

  return (
    <SceneFrame
      step={4}
      title="Simulating the race"
      subtitle="Five hundred runs, lap by lap, with the safety car rolling the dice each time."
    >
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

          {SERIES.map((series, index) => (
            <DegradationCurve
              key={series.compound.id}
              series={series}
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
          {SERIES.map((series, index) => (
            <CurveKey
              key={series.compound.id}
              series={series}
              progress={progress}
              index={index}
            />
          ))}
        </ul>

        <div className="mt-5">
          <div className="h-1 overflow-hidden rounded-full bg-neutral-800">
            <motion.div
              style={{ scaleX: barScale }}
              className="h-full origin-left bg-red-500"
            />
          </div>
          <p className="mt-3 flex items-baseline justify-center gap-2 text-xs tracking-[0.2em] text-neutral-500 uppercase">
            Run
            <motion.span className="text-base text-neutral-100 tabular-nums">
              {runsLabel}
            </motion.span>
            of {MONTE_CARLO_RUNS}
          </p>
        </div>
      </div>
    </SceneFrame>
  )
}
