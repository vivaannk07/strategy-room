import { useEffect, useState } from 'react'

/**
 * Loads one API resource and tracks it as `{ status, data, error, retry }`.
 *
 * `params` is the request: `null` means "nothing to fetch yet" (status `idle`), and any
 * change to it — compared by value, not identity — aborts the previous request and
 * starts a new one. `load(params, signal)` must be a stable function (module scope);
 * everything that varies belongs in `params`.
 *
 * Only the settled result is stored. `loading` is derived — the settled result belongs to
 * a different request — which keeps the effect free of synchronous setState calls, the
 * same reason <PickRaceScene> keeps its request in a single object.
 *
 * `error` is `{ message, status, code }` so callers can branch on the API's error code.
 */
export function useApiResource(params, load) {
  const key = params == null ? null : JSON.stringify(params)
  // Bumped by `retry`. Part of the request id, so retrying the same params re-runs the
  // effect and reads as loading until it settles.
  const [attempt, setAttempt] = useState(0)
  const [settled, setSettled] = useState({ id: null, data: null, error: null })
  const id = key == null ? null : `${attempt}:${key}`

  useEffect(() => {
    if (id == null) return undefined

    const controller = new AbortController()
    load(JSON.parse(key), controller.signal)
      .then((data) => setSettled({ id, data, error: null }))
      .catch((cause) => {
        // StrictMode's double-mount and superseded requests abort; neither is a failure.
        if (cause.name === 'AbortError') return
        setSettled({
          id,
          data: null,
          error: { message: cause.message, status: cause.status, code: cause.code },
        })
      })

    return () => controller.abort()
  }, [id, key, load])

  const retry = () => setAttempt((n) => n + 1)

  if (id == null) return { status: 'idle', data: null, error: null, retry }
  if (settled.id !== id) return { status: 'loading', data: null, error: null, retry }
  if (settled.error) return { status: 'error', data: null, error: settled.error, retry }
  return { status: 'ready', data: settled.data, error: null, retry }
}
