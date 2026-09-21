/**
 * Thin fetch wrapper for the Strategy Room API.
 *
 * The backend serves `http://localhost:8000/api` in dev and its CORS allowlist already
 * names the Vite dev server, so the browser can call it cross-origin without a proxy.
 * Override with `VITE_API_BASE_URL` when the API lives somewhere else.
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api'

/**
 * How long a simulation gets before the UI gives up on it. A warm run is a few seconds;
 * a race whose pace model has never been fitted adds the fit on top.
 */
const SIMULATION_TIMEOUT_MS = 60_000

/** Resolve against the page origin so a relative base (e.g. `/api`) works too. */
function apiUrl(path) {
  return new URL(`${API_BASE_URL}${path}`, window.location.origin)
}

/** True for the DOMException fetch raises when the caller's AbortSignal fires. */
function isAbort(error) {
  return error.name === 'AbortError'
}

/**
 * False for a 4xx: the same request will get the same answer, so a retry button would
 * only invite the user to hit it again. Network failures, timeouts and 5xx can recover.
 */
export function isRetryable(error) {
  return !(error?.status >= 400 && error?.status < 500)
}

/**
 * Re-throws cancellation as-is, and turns our own timeout into a readable error. Both
 * surface from any await on a fetch — the request, or reading its body.
 */
function rethrowCancellation(cause, timeoutMs) {
  if (isAbort(cause)) throw cause
  if (cause.name === 'TimeoutError') {
    throw new Error(`The API didn't respond within ${timeoutMs / 1000}s.`, { cause })
  }
}

/**
 * Builds the error for a non-2xx response, preferring the API's own `detail` over the
 * bare status line. FastAPI puts its 404/502 explanations there, and those are far more
 * useful than "API request failed (502 Bad Gateway)".
 *
 * The error carries `status`, and `code` when the API sent a structured detail — the 409
 * for an unsimulatable race is `{ code: 'unsupported_conditions', message, ... }`.
 */
async function responseError(response, timeoutMs) {
  const status = `API request failed (${response.status} ${response.statusText})`
  const withMeta = (message, code) =>
    Object.assign(new Error(message), { status: response.status, code })

  let body
  try {
    body = await response.text()
  } catch (cause) {
    rethrowCancellation(cause, timeoutMs)
    return withMeta(status)
  }

  try {
    const { detail } = JSON.parse(body)
    // Only surface a string detail or a structured one's message — an HTML error page
    // or a validation array would be noise in the UI.
    if (typeof detail === 'string' && detail) return withMeta(`${status}: ${detail}`)
    if (typeof detail?.message === 'string') {
      return withMeta(`${status}: ${detail.message}`, detail.code)
    }
    return withMeta(status)
  } catch {
    return withMeta(status)
  }
}

async function requestJson(url, { method = 'GET', body, signal, timeoutMs } = {}) {
  const signals = [signal, timeoutMs && AbortSignal.timeout(timeoutMs)].filter(Boolean)

  let response
  try {
    response = await fetch(url, {
      method,
      signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (cause) {
    rethrowCancellation(cause, timeoutMs)
    // fetch only rejects on network-level failure — the API being down is the likely one.
    throw new Error("Couldn't reach the API. Is the backend running?", { cause })
  }

  if (!response.ok) {
    throw await responseError(response, timeoutMs)
  }

  try {
    return await response.json()
  } catch (cause) {
    // A 200 carrying something other than JSON — a proxy's HTML error page, say.
    rethrowCancellation(cause, timeoutMs)
    throw new Error("The API returned a response that couldn't be read as JSON.", {
      cause,
    })
  }
}

/**
 * GET /api/races — past races available to select from, most recent seasons first.
 * Resolves to `[{ season, round, race_name, circuit_id, circuit_name, date }]`.
 */
export function fetchRaces({ signal, season, limit } = {}) {
  const url = apiUrl('/races')
  if (season != null) url.searchParams.set('season', season)
  if (limit != null) url.searchParams.set('limit', limit)
  return requestJson(url, { signal })
}

/**
 * GET /api/races/{season}/{round} — the race plus every driver who took part, with their
 * actual pit stops (`{ stop, lap, duration_seconds }`, no compound) and result. Slow the
 * first time a race is opened: the backend fetches it from Jolpica before answering.
 */
export function fetchRaceDetail({ season, round, signal }) {
  return requestJson(apiUrl(`/races/${season}/${round}`), { signal })
}

/**
 * GET /api/races/{season}/{round}/drivers/{driver_id}/laps — one driver's recorded laps,
 * `[{ lap, position, lap_time_seconds }]`. Lap times are raw: pit laps, lap 1 and
 * safety-car laps included.
 */
export function fetchDriverLaps({ season, round, driverId, signal }) {
  const driver = encodeURIComponent(driverId)
  return requestJson(apiUrl(`/races/${season}/${round}/drivers/${driver}/laps`), {
    signal,
  })
}

/**
 * POST /api/simulate — runs the Monte Carlo for a hypothetical strategy
 * (`[{ lap, compound_in }]`). Rejects with `code: 'unsupported_conditions'` (409) for a
 * race run in wet or mixed conditions.
 */
export function runSimulation({
  season,
  round,
  driverId,
  strategy,
  numSimulations,
  signal,
  timeoutMs = SIMULATION_TIMEOUT_MS,
}) {
  return requestJson(apiUrl('/simulate'), {
    method: 'POST',
    body: {
      season,
      round,
      driver_id: driverId,
      strategy,
      num_simulations: numSimulations,
    },
    signal,
    timeoutMs,
  })
}
