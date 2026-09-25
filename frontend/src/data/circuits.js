/**
 * Circuit geometry for the track art, keyed by Jolpica `circuitId` (`monza`, `spa`…).
 *
 * Jolpica publishes no circuit geometry, so nothing here is fetched: every entry is
 * hand-authored SVG. Until a circuit has its own entry, `circuitFor` hands back the
 * generic fallback, which reads as "a track" without claiming to be any real one.
 *
 * An entry is `{ id, name, path, bounds }`: `path` is the lap as one closed SVG path,
 * starting and ending on the start/finish line, and `bounds` is the `viewBox` that
 * frames it tightly (callers pad it themselves if they need room for a label).
 */
export const FALLBACK_CIRCUIT = {
  id: 'generic',
  name: 'Generic circuit',
  path:
    'M60 196 C60 170 62 150 82 140 C108 128 150 140 168 122 C186 104 172 78 192 64 ' +
    'C214 48 252 56 272 44 C296 30 330 36 342 58 C354 80 338 104 314 112 ' +
    'C286 122 252 112 236 130 C220 148 236 170 222 188 C206 208 166 206 130 208 ' +
    'C96 210 60 216 60 196 Z',
  bounds: { x: 60, y: 36.5, width: 286, height: 174 },
}

/** Real circuits, keyed by Jolpica `circuitId`. Empty until one is drawn. */
export const CIRCUITS = {}

/** The circuit to draw for a Jolpica `circuitId` — never undefined. */
export function circuitFor(circuitId) {
  return (circuitId && CIRCUITS[circuitId]) || FALLBACK_CIRCUIT
}
