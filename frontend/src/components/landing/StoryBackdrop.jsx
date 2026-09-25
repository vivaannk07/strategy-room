import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  motion,
  useMotionValue,
  useMotionValueEvent,
  useSpring,
  useTransform,
} from 'framer-motion'
import { circuitFor } from '../../data/circuits'
import { NEUTRAL_TINT } from '../../lib/raceData'

/**
 * The layers behind the whole landing page: a near-black base, a soft glow tinted for
 * the scene on screen, and the circuit — a faint full outline with the lap drawing
 * itself over it as the page scrolls, and a dot for the car at the head of the line.
 *
 * Rendered by <ScrollStory> through its `backdrop` slot, which mounts it once in a layer
 * fixed to the viewport behind the hero, every scene and the footer, so it reads the same
 * `scrollYProgress` the scenes do without ever fading with one of them. Everything here
 * is decorative and pointer-transparent.
 *
 * Colour never animates. Each scene gets its own glow, drawn line and dot in its own
 * colour, and only their opacity follows the scroll — so a colour change between scenes
 * is a crossfade of two layers, which stays on the compositor where an interpolated
 * `stroke` or `background` would repaint every frame.
 */

const BASE = '#0B0C0E'

// Every keyframe array here follows the same rule as `sceneStops` in <ScrollStory>: six
// stops, strictly increasing, from exactly 0 to exactly 1.
//
// The line draws once, at a constant rate, across the whole story: nothing drawn at its
// top, the full lap at its end — one continuous draw, never restarting per scene. The
// progress Framer hands out is clamped to 0–1, so over the hero the lap waits at 0 (the
// faint outline alone) and under the footer it stays complete.
const DRAW_POINTS = [0, 0.2, 0.4, 0.6, 0.8, 1]
const DRAW_OFFSETS = [1000, 800, 600, 400, 200, 0]

// Light smoothing on the draw so the car glides between wheel notches instead of jumping
// a notch at a time. Overdamped (critical is ~19 at this stiffness), so it never runs
// past the scroll position and back.
const DRAW_SPRING = { stiffness: 90, damping: 26, restDelta: 0.0005 }

// Stroke weights in CSS px, whatever size the circuit is drawn at.
const OUTLINE_PX = 2
const LINE_PX = 2
const DOT_PX = 6

// Peak opacities at full tint strength. The drawn line is a background, not a chart: at
// 0.3 it stays under the scene text and the charts' own lines.
const OUTLINE_ALPHA = 0.07
const LINE_ALPHA = 0.3
const DOT_ALPHA = 0.45

// Glow alpha at full strength. Kept low enough that a scene heading on the brightest
// tint (hard, near-white) still clears 4.5:1.
const GLOW_ALPHA = 0.16

// Room around the circuit inside its own viewBox, as a fraction of each dimension.
const VIEWBOX_PAD = 0.08

// Each tint crossfades across the seam between two scenes, `fade` either side of it, as
// a fraction of one scene's slice. Under reduced motion it becomes a cut.
const TINT_FADE = 0.2
const REDUCED_TINT_FADE = 0.005

/**
 * Six stops for scene `index`'s tint: fully up across its own slice, ramping across
 * each seam it shares with a neighbour. Unlike the scenes' own handoff the two ramps
 * overlap on purpose — this is a colour crossfade, not text, so there's nothing to keep
 * from double-exposing. `fade` is under half a slice, so the stops stay strictly
 * increasing and the middle ones never leave (0, 1). The first and last tints hold their
 * outer edge, so the hero reads scene 1's tint and the footer scene 5's.
 */
function tintStops(index, count, fadeFraction) {
  const span = 1 / count
  const fade = Math.min(Math.max(fadeFraction, 0.001), 0.49) * span
  const start = index * span
  const end = start + span
  const isFirst = index === 0
  const isLast = index === count - 1

  const head = isFirst ? [0, fade * 0.5, fade] : [0, start - fade, start + fade]
  const foot = isLast ? [1 - fade, 1 - fade * 0.5, 1] : [end - fade, end + fade, 1]

  return {
    points: [...head, ...foot],
    values: [...(isFirst ? [1, 1, 1] : [0, 0, 1]), ...(isLast ? [1, 1, 1] : [1, 0, 0])],
  }
}

/** `#RRGGBB` + alpha → `rgba()`. Anything malformed renders as the neutral tint. */
function rgba(hex, alpha) {
  const match =
    /^#([0-9a-f]{6})$/i.exec(hex ?? '') ?? /^#([0-9a-f]{6})$/i.exec(NEUTRAL_TINT)
  const n = parseInt(match[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/** This scene's tint opacity against scroll, peaking at `peak`. */
function useTintOpacity(scrollYProgress, index, count, reduced, peak) {
  const fade = reduced ? REDUCED_TINT_FADE : TINT_FADE
  const { points, values } = tintStops(index, count, fade)
  return useTransform(
    scrollYProgress,
    points,
    values.map((v) => v * peak),
  )
}

function Glow({ tint, index, count, reduced, scrollYProgress }) {
  const opacity = useTintOpacity(scrollYProgress, index, count, reduced, 1)
  const alpha = GLOW_ALPHA * tint.strength

  return (
    <motion.div
      data-tint-layer="glow"
      data-tint-scene={index + 1}
      data-tint-color={tint.color}
      className="absolute inset-0 will-change-[opacity]"
      style={{
        opacity,
        background: `radial-gradient(60% 55% at 50% 50%, ${rgba(tint.color, alpha)} 0%, ${rgba(tint.color, 0)} 100%)`,
      }}
    />
  )
}

function DrawnLine({ tint, index, count, reduced, scrollYProgress, path, dashoffset, unit }) {
  const opacity = useTintOpacity(
    scrollYProgress,
    index,
    count,
    reduced,
    LINE_ALPHA * tint.strength,
  )

  return (
    <motion.path
      data-tint-layer="line"
      data-tint-scene={index + 1}
      data-tint-color={tint.color}
      d={path}
      pathLength="1000"
      fill="none"
      stroke={tint.color}
      strokeWidth={LINE_PX * unit}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Dash then a gap twice the lap: however far the offset is pushed past a full
      // lap, the gap is still what's showing, so nothing wraps back into view.
      strokeDasharray="1000 2000"
      style={{ opacity, strokeDashoffset: dashoffset }}
    />
  )
}

function CarDot({ tint, index, count, reduced, scrollYProgress, unit }) {
  const opacity = useTintOpacity(
    scrollYProgress,
    index,
    count,
    reduced,
    DOT_ALPHA * tint.strength,
  )

  return (
    <motion.circle
      data-tint-layer="dot"
      data-tint-scene={index + 1}
      data-tint-color={tint.color}
      r={(DOT_PX / 2) * unit}
      fill={tint.color}
      style={{ opacity }}
    />
  )
}

// Enough points that linear interpolation between them is indistinguishable from the
// curve at any size it's drawn.
const SAMPLE_COUNT = 400

// Tailwind's `sm`. Below it is a phone, where the lap is reframed from scene 2 on.
const WIDE_QUERY = '(min-width: 40rem)'

// Room around the phone's stretched lap: just enough for the stroke, since its frame is
// already sized to where the lap should run.
const STRETCHED_PAD = 0.01

const round = (n) => Math.round(n * 100) / 100

/** `bbox` grown by `pad` of its own size on every side, as a viewBox string. */
function paddedViewBox({ x, y, width, height }, pad) {
  const padX = width * pad
  const padY = height * pad
  return [x - padX, y - padY, width + padX * 2, height + padY * 2].map(round).join(' ')
}

/** Whether `query` matches, kept current. */
function useMedia(query) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
  )
}

/**
 * Stops for the phone's handoff from the centred lap to the stretched one, across the
 * seam into scene 2 — where both scenes are faded out, so the swap happens on an empty
 * stage. Six stops from 0 to 1, like every keyframe array here.
 */
function handoffStops(count, reduced) {
  const seam = 1 / count
  const fade = (reduced ? REDUCED_TINT_FADE : TINT_FADE) * seam
  return [0, (seam - fade) / 2, seam - fade, seam + fade, (1 + seam + fade) / 2, 1]
}

/**
 * One drawing of the circuit inside its frame: the faint outline, the lap drawing over it
 * in each scene's colour, and the car at its head.
 *
 * `stretch` redraws the lap to its frame's aspect instead of fitting it whole: the path is
 * sampled and rebuilt with its height scaled, so the strokes, the draw and the car all
 * work off a real path of that shape. Stretching the SVG instead would stretch the stroke
 * widths and the dot along with it.
 */
function Track({
  path,
  bounds,
  pad,
  stretch,
  frame,
  className,
  opacity,
  layers,
  drawn,
  dashoffset,
  count,
  reduced,
  scrollYProgress,
}) {
  const frameRef = useRef(null)
  const sourceRef = useRef(null)
  const outlineRef = useRef(null)
  const svgRef = useRef(null)

  // The viewBox is the path's own measured box plus padding, so any circuit fits whole
  // however its path was authored. `bounds` from the data is only the first frame's guess.
  const [viewBox, setViewBox] = useState(() => paddedViewBox(bounds, pad))

  // User units per CSS px, so strokes keep their px weight at every size the circuit is
  // drawn. Follows the SVG's box; nothing is measured while scrolling.
  const [unit, setUnit] = useState(1)

  const [stretched, setStretched] = useState(null)
  const d = stretch ? stretched : path

  // The car rides the head of the drawn line. Its position is sampled off the rendered
  // path once per shape, then looked up per frame — no geometry queries while scrolling.
  const samplesRef = useRef([])
  const carX = useMotionValue(0)
  const carY = useMotionValue(0)

  const placeCar = useCallback(
    (fraction) => {
      const samples = samplesRef.current
      if (!samples.length) return
      const at = (reduced ? 1 : Math.min(Math.max(fraction, 0), 1)) * (samples.length - 1)
      const i = Math.floor(at)
      const a = samples[i]
      const b = samples[Math.min(i + 1, samples.length - 1)]
      const t = at - i
      carX.set(a.x + (b.x - a.x) * t)
      carY.set(a.y + (b.y - a.y) * t)
    },
    [reduced, carX, carY],
  )

  // Rebuilds the stretched lap whenever its frame changes size. Only the height scales,
  // about the lap's middle, by whatever makes the lap's box the frame's shape. It never
  // squashes: a frame wider than the lap just gets the lap as drawn.
  useLayoutEffect(() => {
    const source = sourceRef.current
    const frameEl = frameRef.current
    if (!stretch || !source?.getTotalLength || !frameEl) return
    const total = source.getTotalLength()
    const points = Array.from({ length: SAMPLE_COUNT + 1 }, (_, i) =>
      source.getPointAtLength((total * i) / SAMPLE_COUNT),
    )
    const box = source.getBBox()
    const middle = box.y + box.height / 2
    const refit = () => {
      const { width, height } = frameEl.getBoundingClientRect()
      if (!width || !height) return
      const k = Math.max(height / width / (box.height / box.width), 1)
      setStretched(
        `M${points.map((p) => `${round(p.x)} ${round(middle + (p.y - middle) * k)}`).join('L')}Z`,
      )
    }
    refit()
    const observer = new ResizeObserver(refit)
    observer.observe(frameEl)
    return () => observer.disconnect()
  }, [stretch, path])

  useLayoutEffect(() => {
    const el = outlineRef.current
    if (!d || !el?.getTotalLength) return
    setViewBox(paddedViewBox(el.getBBox(), pad))
    const total = el.getTotalLength()
    samplesRef.current = Array.from({ length: SAMPLE_COUNT + 1 }, (_, i) => {
      const point = el.getPointAtLength((total * i) / SAMPLE_COUNT)
      return { x: point.x, y: point.y }
    })
    placeCar(drawn.get())
  }, [d, pad, placeCar, drawn])

  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const [, , vbWidth, vbHeight] = viewBox.split(' ').map(Number)
    const measure = () => {
      const { width, height } = svg.getBoundingClientRect()
      const scale = Math.min(width / vbWidth, height / vbHeight)
      if (scale > 0) setUnit(1 / scale)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [viewBox])

  useMotionValueEvent(drawn, 'change', placeCar)

  const shared = { count, reduced, scrollYProgress, unit }

  return (
    <motion.div
      ref={frameRef}
      data-track-frame={frame}
      className={className}
      style={opacity && { opacity }}
    >
      <svg
        ref={svgRef}
        data-story-track
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 h-full w-full"
      >
        {stretch && <path ref={sourceRef} d={path} fill="none" stroke="none" />}
        {d && (
          <>
            <path
              ref={outlineRef}
              data-track-layer="outline"
              d={d}
              fill="none"
              stroke="#FFFFFF"
              strokeOpacity={OUTLINE_ALPHA}
              strokeWidth={OUTLINE_PX * unit}
              strokeLinejoin="round"
            />
            {layers.map((tint, index) => (
              <DrawnLine
                key={index}
                tint={tint}
                index={index}
                path={d}
                dashoffset={dashoffset}
                {...shared}
              />
            ))}
            <motion.g data-story-car style={{ x: carX, y: carY }}>
              {layers.map((tint, index) => (
                <CarDot key={index} tint={tint} index={index} {...shared} />
              ))}
            </motion.g>
          </>
        )}
      </svg>
    </motion.div>
  )
}

// How strongly the art is kept out from behind each kind of heading line, as the opacity
// of a base-coloured layer laid over it (1 hides the art completely). The minimum each
// needs for 4.5:1 was measured against the brightest backdrop any scene can show — a
// white tint at full strength, with glow, outline, line and dot all stacked under the
// text: eyebrow 0.91, title 0.39, subtitle 0.73. The eyebrow is hidden fully; the other
// two keep a margin over their minimum.
const HEADING_OCCLUSION = { eyebrow: 1, title: 0.45, subtitle: 0.78 }

// In px. The occlusion ramps in across `HEADING_FEATHER` above the first line and out
// across it below the last, so no edge crosses the track. Between two lines of different
// strength it steps inside the weaker line, within `HEADING_RAMP` of its edge, so the
// stronger line is covered at its full strength top to bottom. `HEADING_MARGIN` pads
// each line.
const HEADING_FEATHER = 64
const HEADING_RAMP = 12
const HEADING_MARGIN = 4

/** `el`'s top inside `ancestor` from layout alone, so the scenes' transforms don't count. */
function offsetTopWithin(el, ancestor) {
  let top = 0
  for (let node = el; node && node !== ancestor; node = node.offsetParent) top += node.offsetTop
  return top
}

/**
 * Each scene's heading lines — its `data-scene-heading` elements, whose value names the
 * kind — as `[{ kind, top, bottom }]` in stage px, top to bottom; null until measured.
 *
 * Re-measured whenever a scene's layout changes, not just on resize: each scene is
 * centred in the stage, so a card loading or growing moves the heading above it.
 */
function useHeadingLines(rootRef, count) {
  const [headings, setHeadings] = useState(null)

  useLayoutEffect(() => {
    const story = rootRef.current?.closest('[data-scroll-story]')
    if (!story) return
    let pending = 0
    const watched = new Set()
    const resizes = new ResizeObserver(() => schedule())
    const watch = (el) => {
      if (el && !watched.has(el)) {
        watched.add(el)
        resizes.observe(el)
      }
    }

    const measure = () => {
      pending = 0
      for (const el of watched) {
        if (!el.isConnected) {
          resizes.unobserve(el)
          watched.delete(el)
        }
      }
      const found = [...story.querySelectorAll('[data-story-scene]')].map((scene) => {
        watch(scene)
        const lines = [...scene.querySelectorAll('[data-scene-heading]')].map((el) => {
          watch(el.parentElement)
          const top = offsetTopWithin(el, scene)
          return { kind: el.dataset.sceneHeading, top, bottom: top + el.offsetHeight }
        })
        return lines.length ? lines.sort((a, b) => a.top - b.top) : null
      })
      // A scene without a heading borrows its nearest neighbour's, so no scene is left
      // without occlusion somewhere the page could have text.
      const next = found.map((lines, i) => {
        for (let d = 0; d < found.length; d++) {
          const near = found[i - d] ?? found[i + d]
          if (near) return near
        }
        return lines
      })
      const usable = next.length === count && next.every(Boolean)
      setHeadings((current) =>
        usable && JSON.stringify(current) !== JSON.stringify(next) ? next : current,
      )
    }
    const schedule = () => {
      if (!pending) pending = requestAnimationFrame(measure)
    }

    const mutations = new MutationObserver(schedule)
    mutations.observe(story, { childList: true, subtree: true })
    measure()
    return () => {
      cancelAnimationFrame(pending)
      resizes.disconnect()
      mutations.disconnect()
    }
  }, [rootRef, count])

  return headings
}

/**
 * One scene's occlusion as `{ top, height, gradient }` in stage px: a vertical gradient
 * of the base colour, at each line's own strength over that line, feathering to nothing
 * above and below the block.
 */
function occlusionFor(lines) {
  const level = (line) => (line ? (HEADING_OCCLUSION[line.kind] ?? 1) : 0)
  const first = lines[0]
  const last = lines[lines.length - 1]
  const stops = [[first.top - HEADING_MARGIN - HEADING_FEATHER, 0]]
  lines.forEach((line, i) => {
    const here = level(line)
    const ramp = Math.min(HEADING_RAMP, (line.bottom - line.top) / 3)
    const from = level(lines[i - 1]) > here ? line.top + ramp : line.top - HEADING_MARGIN
    const to = level(lines[i + 1]) > here ? line.bottom - ramp : line.bottom + HEADING_MARGIN
    stops.push([from, here], [to, here])
  })
  stops.push([last.bottom + HEADING_MARGIN + HEADING_FEATHER, 0])
  const top = stops[0][0]
  return {
    top,
    height: stops[stops.length - 1][0] - top,
    gradient: `linear-gradient(to bottom, ${stops.map(([y, o]) => `${rgba(BASE, o)} ${round(y - top)}px`).join(', ')})`,
  }
}

/**
 * Keeps the art out from behind one scene's heading, laid over all of it. The gradient
 * only changes when the scene's layout does; scrolling only moves its opacity, which
 * crossfades with the neighbouring scenes' over the window the scenes themselves hand
 * off in (a cut under reduced motion). Covering the art with the base colour at opacity
 * `o` gives exactly what masking it to `1 - o` over that base would.
 */
function HeadingOcclusion({ lines, index, count, overlap, scrollYProgress }) {
  const { points, values } = tintStops(index, count, overlap)
  const opacity = useTransform(scrollYProgress, points, values)
  const { top, height, gradient } = occlusionFor(lines)

  return (
    <motion.div
      data-heading-occlusion={index + 1}
      className="absolute inset-x-0 will-change-[opacity]"
      style={{ top, height, backgroundImage: gradient, opacity }}
    />
  )
}

/**
 * @param {import('framer-motion').MotionValue<number>} scrollYProgress  The story's.
 * @param {number} count  Number of scenes.
 * @param {boolean} reduced  prefers-reduced-motion.
 * @param {number} [overlap]  The scenes' handoff width, as a fraction of a slice.
 * @param {Array<{color: string, strength: number}>} tints  One per scene. Missing
 *   entries or colours render neutral.
 * @param {string} [circuitId]  Jolpica circuitId; falls back to the generic circuit.
 */
export default function StoryBackdrop({
  scrollYProgress,
  count,
  reduced,
  overlap = 0.1,
  tints,
  circuitId,
}) {
  const circuit = circuitFor(circuitId)
  const phone = !useMedia(WIDE_QUERY)

  const rootRef = useRef(null)
  const headings = useHeadingLines(rootRef, count)

  const layers = Array.from({ length: count }, (_, index) => {
    const tint = tints?.[index]
    return {
      color: /^#[0-9a-f]{6}$/i.test(tint?.color ?? '') ? tint.color : NEUTRAL_TINT,
      strength: Number.isFinite(tint?.strength) ? tint.strength : 1,
    }
  })

  // Smoothed off the same progress the scenes read. Reduced motion skips the spring and
  // keeps the lap fully drawn rather than scrubbing it.
  const smoothed = useSpring(scrollYProgress, DRAW_SPRING)
  const drawn = reduced ? scrollYProgress : smoothed
  const dashoffset = useTransform(
    drawn,
    DRAW_POINTS,
    reduced ? DRAW_POINTS.map(() => 0) : DRAW_OFFSETS,
  )

  const handoff = handoffStops(count, reduced)
  const centredOpacity = useTransform(scrollYProgress, handoff, [1, 1, 1, 0, 0, 0])
  const stretchedOpacity = useTransform(scrollYProgress, handoff, [0, 0, 0, 1, 1, 1])

  const track = {
    path: circuit.path,
    bounds: circuit.bounds,
    layers,
    drawn,
    dashoffset,
    count,
    reduced,
    scrollYProgress,
  }

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      data-story-backdrop
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ backgroundColor: BASE }}
    >
      {/* Sized to the story's pinned stage, so the art is centred on what the scenes are
          centred on, and doesn't rescale when mobile chrome hides. */}
      <div className="absolute inset-x-0 top-0 h-stage">
        {layers.map((tint, index) => (
          <Glow key={index} tint={tint} index={index} {...track} />
        ))}

        {/* The circuit's frame. Narrower than the stage on wider screens, so the lap
            takes about two-thirds of the width there rather than all of it; on a phone
            it's the full width inside the safe area, through the hero and scene 1. */}
        <Track
          {...track}
          frame="centred"
          pad={VIEWBOX_PAD}
          opacity={phone ? centredOpacity : undefined}
          className="absolute inset-y-[12%] right-[env(safe-area-inset-right)] left-[env(safe-area-inset-left)] sm:inset-x-[12%]"
        />

        {/* Phones, from scene 2 on. The cards there cover nearly the full width and the
            middle of the height, so a centred lap sits entirely behind them. This frame
            runs the lap down the side margins, with its ends in the bands above and below
            the cards. */}
        {phone && (
          <Track
            {...track}
            frame="stretched"
            stretch
            pad={STRETCHED_PAD}
            opacity={stretchedOpacity}
            className="absolute top-[11%] right-[calc(2%+env(safe-area-inset-right))] bottom-[1.5%] left-[calc(2%+env(safe-area-inset-left))]"
          />
        )}

        {/* Over all the art: each scene's heading occlusion, so the scene's text reads
            against the base whatever the lap, dot or glow behind it is doing. */}
        {headings?.map((lines, index) => (
          <HeadingOcclusion
            key={index}
            lines={lines}
            index={index}
            count={count}
            overlap={overlap}
            scrollYProgress={scrollYProgress}
          />
        ))}
      </div>
    </div>
  )
}
