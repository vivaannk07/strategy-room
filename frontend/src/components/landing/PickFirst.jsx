/**
 * Scene-card placeholder for scenes 2–5 until scene 1 has a race and a driver — or, via
 * `children`, any other reason a scene has nothing to show yet.
 */
export default function PickFirst({ children = 'Pick a race and a driver in scene 1 first.' }) {
  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-neutral-800 bg-neutral-900 p-5 sm:p-7">
      <p className="py-8 text-sm text-neutral-400">{children}</p>
    </div>
  )
}
