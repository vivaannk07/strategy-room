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
 * Each scene owns an equal `span` of the timeline. The seam between two
 * neighbours is handed over rather than dissolved: the outgoing scene spends
 * the `fade` before the boundary going from opacity 1 to 0, and the incoming
 * scene spends the `fade` after it going from 0 to 1. Neither ramp reaches into
 * the other's side, so there is no progress value at which both scenes carry
 * readable text — the double exposure two overlapping ramps used to produce.
 * The first and last scenes hold their outer edge open instead of fading, so
 * the story opens and closes on a settled scene.
 *
 * The scenes still move through the handoff: the outgoing one is pushed out of
 * the way as it fades, travelling further on the way out than the next scene
 * drifts in, so the seam reads as one scene leaving and another arriving rather
 * than a straight cut. The separation is carried by transform and opacity
 * alone: an animated `filter` would be repainted every frame over a full-stage
 * layer, which is exactly the kind of work that drops frames on a phone.
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
  // A non-finite overlap degrades to the default rather than poisoning every
  // stop with NaN: `Math.max(NaN, 0.001)` is NaN, and a NaN keyframe stop makes
  // the whole scene's transform undefined rather than merely mistimed.
  const width = Number.isFinite(overlap) ? overlap : DEFAULT_OVERLAP
  const fade = Math.min(Math.max(width, 0.001), 0.49) * span
  const start = index * span
  const end = start + span
  const isFirst = index === 0
  const isLast = index === count - 1

  // Edge scenes have no neighbour to hand over to, so their outer pair of stops
  // is tucked in against 0 / 1 and carries a held value instead of a fade.
  //
  // For the rest, the middle stop of each triplet sits *on* the boundary: the
  // entry ramp runs boundary → boundary + fade and the exit ramp runs
  // boundary - fade → boundary, which is what keeps the two sides disjoint.
  // `fade` is under half a span (overlap is clamped to 0.49), so `start + fade`
  // stays below `end - fade` and the six stops stay strictly increasing.
  const head = isFirst ? [0, fade * 0.25, fade * 0.5] : [0, start, start + fade]
  const foot = isLast ? [1 - fade * 0.5, 1 - fade * 0.25, 1] : [end - fade, end, 1]

  return {
    points: [...head, ...foot],
    enter: [...(isFirst ? [1, 1, 1] : [0, 0, 1]), ...(isLast ? [1, 1, 1] : [1, 0, 0])],
    // 1 → 0 → -1 across the scene: the same stops drive a scene sliding up and
    // out as the next one slides in from below. Sequenced along with the
    // opacity, so a scene has finished travelling out by the boundary and the
    // next one only starts travelling in from there. The two sides are scaled
    // differently at the call site — see `HEAD_STOPS`.
    exit: [...(isFirst ? [0, 0, 0] : [1, 1, 0]), ...(isLast ? [0, 0, 0] : [0, -1, -1])],
    start,
    end,
  }
}

// `sceneStops` builds its points from a head triplet (this scene entering) and
// a foot triplet (this scene leaving), so the first three entries of every
// output array belong to the entry and the last three to the exit.
const HEAD_STOPS = 3

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
  exitTravel,
  reduced,
}) {
  const { points, enter, exit, start, end } = sceneStops(index, count, overlap)

  // opacity, y and scale each read the scroll position directly off the same
  // stops rather than chaining off one another, which keeps all three numeric
  // and lets Framer Motion drive them through the browser's native
  // ViewTimeline — off the main thread, so the scrub stays smooth.
  // pointer-events is a string, so it stays a JS-side transform — and it is the
  // only one, which is what keeps the whole scrub on the compositor.
  const opacity = useTransform(scrollYProgress, points, enter)
  const y = useTransform(
    scrollYProgress,
    points,
    // Asymmetric on purpose: the entry side drifts in by `travel`, the exit
    // side pulls away by the larger `exitTravel`, so the scene that is fading
    // out is clearly the one leaving and not just the dimmer of two.
    exit.map((v, i) => (reduced ? 0 : v * (i < HEAD_STOPS ? travel : exitTravel))),
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
      // `inert` keeps the off-screen scenes out of the focus order and out of
      // hit-testing. Without it they stay in the DOM at opacity 0, so a keyboard
      // user could tab into an invisible scene's controls — and focusable content
      // inside aria-hidden is a WCAG 4.1.2 failure.
      data-story-scene={index}
      inert={!isActive}
      aria-hidden={!isActive}
      aria-label={scene.label}
      style={{ opacity, y, scale, pointerEvents }}
      // `safe-px`/`safe-py` add the notch and home-indicator insets on top of
      // `--pad-x`/`--pad-y`, so a scene never runs under the system UI. The
      // vertical inset is tighter on phones: the stage is a fixed `svh` and the
      // padding is the only thing competing with the scene for it.
      className="safe-px safe-py absolute inset-0 flex items-center justify-center [--pad-x:1.5rem] [--pad-y:2.5rem] will-change-[transform,opacity] sm:[--pad-x:2.5rem] sm:[--pad-y:4rem]"
    >
      {content}
    </motion.section>
  )
}

/**
 * Scroll-scrubbed story container.
 *
 * Renders a tall spacer (`sceneHeight` of viewport per scene) with a pinned
 * stage inside it, both measured in `svh` so they stay in step while mobile
 * browser chrome hides and shows. Scroll position through the spacer maps to
 * 0→1, which is sliced evenly across the scenes and handed from one to the next
 * at the seams.
 *
 * @param {Array<{id: string, label: string, content: React.ReactNode | Function}>} scenes
 * @param {number} sceneHeight  Scroll distance per scene, in svh. Higher = slower scrub.
 * @param {number} overlap      Width of one side of the seam handoff, as a fraction of a
 *                              scene's slice (0–0.49). The outgoing scene fades out
 *                              across the `overlap` before the boundary and the incoming
 *                              one fades in across the `overlap` after it, so the two
 *                              ramps never coincide and no two scenes are readable at
 *                              once. The whole handoff takes `2 * overlap` of a slice, so
 *                              this is the lever on how long the seam takes — keep it low
 *                              enough that it reads as a handoff, not a dissolve.
 *                              Ignored under `prefers-reduced-motion` — see
 *                              `REDUCED_OVERLAP`.
 * @param {number} travel       Peak vertical drift in px as a scene enters.
 * @param {number} exitTravel   Peak vertical drift in px as a scene leaves. Larger than
 *                              `travel` so the outgoing scene reads as moving away.
 * @param {boolean} showProgress Render the scene rail.
 * @param {Function} backdrop   Optional `({ scrollYProgress, count, reduced, overlap }) => node`,
 *                              where `overlap` is the handoff width the scenes are actually
 *                              using (`REDUCED_OVERLAP` under reduced motion). Mounted
 *                              once, in a layer fixed to the viewport behind the whole page rather than inside the pinned stage,
 *                              so it is on screen from the top of the page to the bottom —
 *                              over whatever comes before and after the story too — and
 *                              never inherits a scene's opacity. The layer sits at a
 *                              negative z-index, so the page must establish a stacking
 *                              context around the story (`isolate`) for it to paint above
 *                              the page's own background. It gets the same progress the
 *                              scenes are driven by, so any scroll-linked keyframes in it
 *                              must follow the same six-stops-from-0-to-1 rule as
 *                              `sceneStops`. It must be pointer-transparent.
 */
// With reduced motion the scenes no longer travel apart on the way out, so the
// fades are all the seam has left to work with — and a fade with nothing moving
// behind it is the dissolve this mode is meant to drop. The ramps are shrunk to
// a few pixels of scroll each instead, which turns the handoff into a cut: the
// state change still happens at the same scroll position, the dissolve that
// carried it does not.
const REDUCED_OVERLAP = 0.005

// One side of the seam handoff, as a fraction of a scene's slice. The dark beat
// between two scenes is `2 * overlap` of a slice wide, so this is the dial on
// how long the screen sits between scenes with neither one readable; 0.10 keeps
// it short enough to read as a handoff.
const DEFAULT_OVERLAP = 0.1

export default function ScrollStory({
  scenes,
  sceneHeight = 110,
  overlap = DEFAULT_OVERLAP,
  travel = 40,
  exitTravel = travel * 2.5,
  showProgress = true,
  backdrop,
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
      data-scroll-story
      className={`h-story relative w-full ${className}`}
      style={{ '--story-h': scenes.length * sceneHeight }}
    >
      {backdrop && (
        // `lvh`, the tallest the viewport gets, so the base colour still reaches the
        // bottom edge while mobile chrome is hidden; the backdrop sizes its own art to
        // the stage inside it.
        <div className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-lvh">
          {backdrop({
            scrollYProgress,
            count: scenes.length,
            reduced,
            overlap: reduced ? REDUCED_OVERLAP : overlap,
          })}
        </div>
      )}

      <div className="sticky top-0 h-stage overflow-hidden">
        <div className="relative h-full w-full">
          {scenes.map((scene, index) => (
            <ScrollStoryScene
              key={scene.id}
              scene={scene}
              index={index}
              count={scenes.length}
              overlap={reduced ? REDUCED_OVERLAP : overlap}
              scrollYProgress={scrollYProgress}
              isActive={index === activeIndex}
              travel={travel}
              exitTravel={exitTravel}
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

// Rendered at every breakpoint, phone included. It is the only thing on screen
// during the seam handoff — both neighbouring scenes are at opacity 0 there — so
// hiding it on narrow screens left phone users staring at a blank stage with no
// sign the story was still moving. It shrinks and tucks closer to the edge
// instead: shorter track, tighter gaps, and a smaller inset so it stays clear of
// scene text at 390px.
function StoryRail({ scenes, activeIndex, scrollYProgress }) {
  const scaleY = useTransform(scrollYProgress, [0, 1], [0, 1])

  return (
    <div className="pointer-events-none absolute top-1/2 right-[calc(0.75rem+env(safe-area-inset-right))] flex -translate-y-1/2 flex-col items-center gap-2 sm:right-[calc(2rem+env(safe-area-inset-right))] sm:gap-3">
      <div className="relative h-24 w-px bg-neutral-700/60 sm:h-40">
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
