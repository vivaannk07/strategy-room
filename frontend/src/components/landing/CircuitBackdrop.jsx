import { motion, useReducedMotion } from 'framer-motion'

/**
 * Atmospheric backdrop for scene 1 — a floodlit circuit at dusk, drawn as SVG.
 *
 * SVG rather than a raster illustration on purpose: it scales to any stage size
 * without a second asset, costs nothing to load, and picks up the same palette the
 * rest of the story uses, so the art can't drift from the UI.
 *
 * Sits behind the scene's content and is decorative, so it's `aria-hidden` and
 * pointer-transparent. The whole layer fades with its scene via <ScrollStory>.
 *
 * `seeThrough` thins the sky, ground and vignette so a layer behind the whole story (the
 * landing page's <StoryBackdrop>) still shows through; without it the art is opaque.
 */
export default function CircuitBackdrop({ className = '', seeThrough = false }) {
  const reduced = useReducedMotion()
  const fillOpacity = seeThrough ? 0.45 : 1

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      <svg
        viewBox="0 0 1200 700"
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
      >
        <defs>
          <linearGradient id="cb-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0a0a0a" />
            <stop offset="55%" stopColor="#1c1616" />
            <stop offset="100%" stopColor="#30191c" />
          </linearGradient>
          <radialGradient id="cb-horizon" cx="50%" cy="100%" r="75%">
            <stop offset="0%" stopColor="#ef4444" stopOpacity="0.5" />
            <stop offset="45%" stopColor="#b91c1c" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="cb-ground" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#14100f" />
            <stop offset="100%" stopColor="#080808" />
          </linearGradient>
          <radialGradient id="cb-bloom" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fde68a" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#fde68a" stopOpacity="0" />
          </radialGradient>
          <filter id="cb-haze" x="-30%" y="-60%" width="160%" height="260%">
            <feGaussianBlur stdDeviation="26" />
          </filter>
        </defs>

        <rect width="1200" height="700" fill="url(#cb-sky)" fillOpacity={fillOpacity} />
        <ellipse cx="600" cy="452" rx="660" ry="210" fill="url(#cb-horizon)" />

        {/* Grandstands and trees on the far side of the circuit. */}
        <g fill="#050505" opacity="0.82">
          <path d="M0 452 L0 406 L104 384 L232 392 L244 452 Z" />
          <path d="M286 452 L298 372 L470 356 L496 452 Z" />
          <path d="M540 452 L552 398 L672 390 L690 452 Z" />
          <path d="M742 452 L760 362 L946 350 L962 452 Z" />
          <path d="M1000 452 L1016 398 L1200 386 L1200 452 Z" />
        </g>

        {/* Lit rows inside the grandstands — just enough to read as a crowd. */}
        <g fill="#ef4444" opacity="0.22">
          <rect x="310" y="386" width="166" height="3" rx="1.5" />
          <rect x="318" y="400" width="150" height="3" rx="1.5" />
          <rect x="772" y="378" width="164" height="3" rx="1.5" />
          <rect x="780" y="394" width="148" height="3" rx="1.5" />
        </g>

        {/* Floodlight pylons. */}
        {[
          { x: 150, top: 214 },
          { x: 428, top: 250 },
          { x: 812, top: 198 },
          { x: 1068, top: 242 },
        ].map((pylon, index) => (
          <g key={pylon.x}>
            <rect
              x={pylon.x - 1.5}
              y={pylon.top}
              width="3"
              height={452 - pylon.top}
              fill="#1c1917"
            />
            <rect
              x={pylon.x - 26}
              y={pylon.top - 12}
              width="52"
              height="14"
              rx="3"
              fill="#292524"
            />
            <motion.circle
              cx={pylon.x}
              cy={pylon.top - 5}
              r="78"
              fill="url(#cb-bloom)"
              initial={false}
              animate={reduced ? { opacity: 0.5 } : { opacity: [0.38, 0.58, 0.38] }}
              transition={
                reduced
                  ? undefined
                  : {
                      duration: 6 + index,
                      repeat: Infinity,
                      ease: 'easeInOut',
                      delay: index * 0.7,
                    }
              }
            />
          </g>
        ))}

        {/* Track surface sweeping out of frame, with kerbing along the inside. */}
        <rect
          y="452"
          width="1200"
          height="248"
          fill="url(#cb-ground)"
          fillOpacity={fillOpacity}
        />
        <path
          d="M-40 700 L430 452 L560 452 L240 700 Z"
          fill="#111010"
          fillOpacity={fillOpacity}
        />
        <path
          d="M430 452 L560 452 L240 700"
          fill="none"
          stroke="#ef4444"
          strokeOpacity="0.1"
          strokeWidth="2"
        />
        <g opacity="0.1">
          {Array.from({ length: 9 }, (_, i) => (
            <rect
              key={i}
              x={404 - i * 40}
              y={470 + i * 26}
              width={26 + i * 3}
              height="5"
              rx="2"
              fill={i % 2 === 0 ? '#ef4444' : '#e5e5e5'}
            />
          ))}
        </g>

        {/* Haze sitting on the horizon, softening everything behind it. */}
        <g filter="url(#cb-haze)" opacity="0.3">
          <ellipse cx="380" cy="448" rx="300" ry="26" fill="#ef4444" opacity="0.25" />
          <ellipse cx="880" cy="442" rx="260" ry="22" fill="#fafafa" opacity="0.08" />
        </g>
      </svg>

      {/* Vignette: pulls the edges down so the scene's text stays the brightest thing. */}
      <div
        className={`absolute inset-0 bg-radial-[at_50%_45%] from-transparent ${
          seeThrough ? 'via-neutral-950/20 to-neutral-950/60' : 'via-neutral-950/45 to-neutral-950/95'
        }`}
      />
    </div>
  )
}
