import { motion, useTransform } from 'framer-motion'
import SceneFrame from './SceneFrame'

/**
 * Scene 4 — placeholder for the Monte Carlo run. Doubles as the reference for
 * how a scene consumes `progress`: the curve draws itself as you scrub, driven
 * off the motion value rather than component state.
 */
export default function SimulatingScene({ progress }) {
  const pathLength = useTransform(progress, [0.15, 0.8], [0, 1], { clamp: true })
  const runs = useTransform(progress, [0.15, 0.8], [0, 500], { clamp: true })
  const runsLabel = useTransform(runs, (v) => Math.round(v).toLocaleString())

  return (
    <SceneFrame
      step={4}
      title="Simulating the race"
      subtitle="Five hundred runs, lap by lap, with the safety car rolling the dice each time."
    >
      <div className="mx-auto max-w-2xl rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6 sm:p-8">
        <svg
          viewBox="0 0 320 120"
          role="img"
          aria-label="Placeholder degradation curve"
          className="h-28 w-full sm:h-36"
        >
          <motion.path
            d="M10 100 C 70 96, 120 84, 160 66 C 200 48, 250 26, 310 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            className="text-red-500"
            style={{ pathLength }}
          />
        </svg>
        <p className="mt-5 flex items-baseline justify-center gap-2 text-xs tracking-[0.2em] text-neutral-500 uppercase">
          <motion.span className="text-base text-neutral-200 tabular-nums">
            {runsLabel}
          </motion.span>
          runs complete
        </p>
      </div>
    </SceneFrame>
  )
}
