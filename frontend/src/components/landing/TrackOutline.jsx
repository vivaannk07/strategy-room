import { motion, useReducedMotion } from 'framer-motion'
import { circuitFor } from '../../data/circuits'

/**
 * Circuit outline with a light running a lap around it.
 *
 * The geometry comes from `src/data/circuits.js`, shared with the story's backdrop
 * track, so a real circuit added there shows up in both. Until then every race gets the
 * generic fallback shape.
 *
 * The car is a short stroke dash chasing its own offset rather than an element on an
 * `offset-path`: dash animation is supported everywhere and stays on the compositor.
 */
export default function TrackOutline({ className = '', label, circuitId }) {
  const reduced = useReducedMotion()
  const trackPath = circuitFor(circuitId).path

  return (
    <svg
      viewBox="26 22 350 216"
      role="img"
      aria-label={label ? `Circuit outline — ${label}` : 'Circuit outline'}
      className={className}
    >
      <defs>
        <linearGradient id="to-edge" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#525252" />
          <stop offset="100%" stopColor="#262626" />
        </linearGradient>
      </defs>

      {/* Run-off around the outside of the ribbon. */}
      <path
        d={trackPath}
        fill="none"
        stroke="#ef4444"
        strokeOpacity="0.08"
        strokeWidth="22"
        strokeLinejoin="round"
      />
      {/* The track ribbon itself. */}
      <path
        d={trackPath}
        fill="none"
        stroke="url(#to-edge)"
        strokeWidth="11"
        strokeLinejoin="round"
      />
      {/* Centre line, so the ribbon reads as a road rather than a border. */}
      <path
        d={trackPath}
        fill="none"
        stroke="#0a0a0a"
        strokeWidth="1"
        strokeDasharray="5 9"
        strokeOpacity="0.7"
      />

      {/* Start/finish line. */}
      <g>
        <rect
          x="52"
          y="188"
          width="16"
          height="3"
          rx="1"
          fill="#fafafa"
          opacity="0.75"
          transform="rotate(-78 60 190)"
        />
        <text
          x="30"
          y="224"
          className="fill-neutral-400 text-[11px] tracking-[0.2em] uppercase"
        >
          S/F
        </text>
      </g>

      {/*
        The car: a short bright dash travelling the full length of the path.
        `pathLength` normalises the path to 1000 units, so the dash + gap can add up to
        exactly one lap — one dash on track at all times, and an offset of -1000 lands
        back where it started, which makes the loop seamless without measuring the path.
      */}
      <motion.path
        d={trackPath}
        pathLength="1000"
        fill="none"
        stroke="#ef4444"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray="26 974"
        initial={{ strokeDashoffset: 0 }}
        animate={reduced ? { strokeDashoffset: 0 } : { strokeDashoffset: -1000 }}
        transition={
          reduced ? undefined : { duration: 9, repeat: Infinity, ease: 'linear' }
        }
      />
    </svg>
  )
}
