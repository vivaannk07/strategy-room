import { useRef, useState } from 'react'
import {
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
} from 'framer-motion'

/**
 * Builds the keyframe stops for one scene's slice of the story's 0→1 progress.
 *
 * Each scene owns an equal `span` of the timeline and overlaps its neighbours
 * by `fade` on either side of their shared boundary — that overlap is the
 * crossfade, and it puts scene N at 50% opacity exactly where scene N+1 is.
 * The first and last scenes hold their outer edge open instead of fading, so
 * the story opens and closes on a settled scene.
 *
 * Every scene returns six stops running from exactly 0 to exactly 1, strictly
 * increasing. That shape is load-bearing, not cosmetic: Framer Motion hands
 * scroll-linked keyframes to the browser's native ViewTimeline, which only
 * covers the range the stops span and mirrors the value back outside it — so a
 * scene whose stops stopped short would fade back in further down the page.
 * Spanning the full range and putting each scene's shape in the output arrays
 * keeps the held edges flat, which makes that mirroring a no-op.
 */
function sceneStops(index, count, overlap) {
  const span = 1 / count
  const fade = Math.min(Math.max(overlap, 0.01), 0.49) * span
  const start = index * span
  const end = start + span
  const isFirst = index === 0
  const isLast = index === count - 1

  // Edge scenes have no neighbour to cross with, so their outer pair of stops
  // is tucked in against 0 / 1 and carries a held value instead of a fade.
  const head = isFirst ? [0, fade * 0.25, fade * 0.5] : [0, start - fade, start + fade]
  const foot = isLast ? [1 - fade * 0.5, 1 - fade * 0.25, 1] : [end - fade, end + fade, 1]

  return {
    points: [...head, ...foot],
    enter: [...(isFirst ? [1, 1, 1] : [0, 0, 1]), ...(isLast ? [1, 1, 1] : [1, 0, 0])],
    // 1 → 0 → -1 across the scene: the same stops drive a scene sliding up and
    // out as the next one slides in from below.
    exit: [...(isFirst ? [0, 0, 0] : [1, 1, 0]), ...(isLast ? [0, 0, 0] : [0, -1, -1])],
    start,
    end,
  }
}

/**
 * One pinned scene. Owns its own transforms so every scene calls the same
 * hooks in the same order regardless of how many scenes the story has.
 */
function ScrollStoryScene({
  scene,
  index,
  count,
  overlap,
  scrollYProgress,
  isActive,
  travel,
  reduced,
}) {
  const { points, enter, exit, start, end } = sceneStops(index, count, overlap)

  // opacity, y and scale each read the scroll position directly off the same
  // stops rather than chaining off one another, which keeps all three numeric
  // and lets Framer Motion drive them through the browser's native
  // ViewTimeline — off the main thread, so the scrub stays smooth.
  // pointer-events is a string, so it stays a JS-side transform.
  const opacity = useTransform(scrollYProgress, points, enter)
  const y = useTransform(
    scrollYProgress,
    points,
    exit.map((v) => (reduced ? 0 : v * travel)),
  )
  const scale = useTransform(
    scrollYProgress,
    points,
    enter.map((v) => (reduced ? 1 : 0.975 + v * 0.025)),
  )
  const pointerEvents = useTransform(opacity, (v) => (v > 0.6 ? 'auto' : 'none'))

  // Local 0→1 across this scene's own slice — scenes use it to drive their
  // internal animation (a curve drawing itself, a bar filling, etc.).
  const progress = useTransform(scrollYProgress, [start, end], [0, 1], {
    clamp: true,
  })

  const content =
    typeof scene.content === 'function'
      ? scene.content({ progress, index, count, isActive })
      : scene.content

  return (
    <motion.section
      aria-hidden={!isActive}
      aria-label={scene.label}
      style={{ opacity, y, scale, pointerEvents }}
      className="absolute inset-0 flex items-center justify-center px-6 py-16 will-change-[transform,opacity] sm:px-10"
    >
      {content}
    </motion.section>
  )
}

/**
 * Scroll-scrubbed story container.
 *
 * Renders a tall spacer (`sceneHeight` of viewport per scene) with a pinned
 * viewport-height stage inside it. Scroll position through the spacer maps to
 * 0→1, which is sliced evenly across the scenes and crossfaded at the seams.
 *
 * @param {Array<{id: string, label: string, content: React.ReactNode | Function}>} scenes
 * @param {number} sceneHeight  Scroll distance per scene, in vh. Higher = slower scrub.
 * @param {number} overlap      Crossfade width as a fraction of one scene's slice (0–0.49).
 * @param {number} travel       Peak vertical drift in px for the enter/exit transform.
 * @param {boolean} showProgress Render the scene rail.
 */
export default function ScrollStory({
  scenes,
  sceneHeight = 110,
  overlap = 0.35,
  travel = 40,
  showProgress = true,
  className = '',
  id,
}) {
  const containerRef = useRef(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const reduced = useReducedMotion()

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end end'],
  })

  // Single piece of state for the whole story: which scene owns the screen.
  // Changes `scenes.length - 1` times over the entire scroll, so it costs
  // nothing — the actual animation runs on motion values, off the React tree.
  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    const next = Math.min(scenes.length - 1, Math.floor(v * scenes.length))
    setActiveIndex((current) => (current === next ? current : next))
  })

  return (
    <div
      id={id}
      ref={containerRef}
      className={`relative w-full ${className}`}
      style={{ height: `${scenes.length * sceneHeight}vh` }}
    >
      <div className="sticky top-0 h-stage overflow-hidden">
        <div className="relative h-full w-full">
          {scenes.map((scene, index) => (
            <ScrollStoryScene
              key={scene.id}
              scene={scene}
              index={index}
              count={scenes.length}
              overlap={overlap}
              scrollYProgress={scrollYProgress}
              isActive={index === activeIndex}
              travel={travel}
              reduced={reduced}
            />
          ))}

          {showProgress && (
            <StoryRail
              scenes={scenes}
              activeIndex={activeIndex}
              scrollYProgress={scrollYProgress}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function StoryRail({ scenes, activeIndex, scrollYProgress }) {
  const scaleY = useTransform(scrollYProgress, [0, 1], [0, 1])

  return (
    <div className="pointer-events-none absolute top-1/2 right-4 hidden -translate-y-1/2 flex-col items-center gap-3 sm:right-8 sm:flex">
      <div className="relative h-40 w-px bg-neutral-700/60">
        <motion.div
          style={{ scaleY }}
          className="absolute inset-0 origin-top bg-red-500"
        />
      </div>
      <ol className="flex flex-col items-center gap-2">
        {scenes.map((scene, index) => (
          <li
            key={scene.id}
            aria-current={index === activeIndex ? 'step' : undefined}
            className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${
              index === activeIndex ? 'bg-red-500' : 'bg-neutral-700'
            }`}
          >
            <span className="sr-only">{scene.label}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
