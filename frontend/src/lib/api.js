/**
 * Thin fetch wrapper for the Strategy Room API.
 *
 * The backend serves `http://localhost:8000/api` in dev and its CORS allowlist already
 * names the Vite dev server, so the browser can call it cross-origin without a proxy.
 * Override with `VITE_API_BASE_URL` when the API lives somewhere else.
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api'

/** Resolve against the page origin so a relative base (e.g. `/api`) works too. */
function apiUrl(path) {
  return new URL(`${API_BASE_URL}${path}`, window.location.origin)
}

/** True for the DOMException fetch raises when the caller's AbortSignal fires. */
function isAbort(error) {
  return error.name === 'AbortError'
}

/**
 * Builds the message for a non-2xx response, preferring the API's own `detail` over
 * the bare status line. FastAPI puts its 404/502 explanations there, and those are far
 * more useful than "API request failed (502 Bad Gateway)".
 */
async function errorMessage(response) {
  const status = `API request failed (${response.status} ${response.statusText})`

  let body
  try {
    body = await response.text()
  } catch (cause) {
    if (isAbort(cause)) throw cause
    return status
  }

  try {
    const { detail } = JSON.parse(body)
    // Only surface a string detail — an HTML error page or a validation array would
    // be noise in the UI.
    return typeof detail === 'string' && detail ? `${status}: ${detail}` : status
  } catch {
    return status
  }
}

async function getJson(url, signal) {
  let response
  try {
    response = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  } catch (cause) {
    // fetch only rejects on network-level failure — the API being down is the likely one.
    if (isAbort(cause)) throw cause
    throw new Error("Couldn't reach the API. Is the backend running?", { cause })
  }

  if (!response.ok) {
    throw new Error(await errorMessage(response))
  }

  try {
    return await response.json()
  } catch (cause) {
    // A 200 carrying something other than JSON — a proxy's HTML error page, say.
    if (isAbort(cause)) throw cause
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
  return getJson(url, signal)
}
