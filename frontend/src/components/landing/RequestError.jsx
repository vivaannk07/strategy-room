/**
 * The landing story's inline error: the message as a plain red line, and a retry button
 * when retrying could help. Every fetch point uses this, so a failure reads the same
 * wherever it happens.
 *
 * @param {string} message
 * @param {Function} [onRetry]  Omit when the same request would fail the same way.
 */
export default function RequestError({ message, onRetry, className = 'py-8' }) {
  return (
    <div className={className}>
      <p className="text-sm text-red-400">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-full border border-neutral-700 px-4 py-1.5 text-xs tracking-wider text-neutral-300 uppercase hover:border-neutral-500"
        >
          Try again
        </button>
      )}
    </div>
  )
}
