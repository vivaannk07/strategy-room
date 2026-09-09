import SceneFrame from './SceneFrame'

const PLACEHOLDER_STINTS = [
  { label: 'Stint 1', span: 'Laps 1–18', width: 'w-[34%]' },
  { label: 'Stint 2', span: 'Laps 19–39', width: 'w-[40%]' },
  { label: 'Stint 3', span: 'Laps 40–53', width: 'w-[26%]' },
]

/** Scene 2 — placeholder for the driver's real stint timeline. */
export default function ActualStrategyScene() {
  return (
    <SceneFrame
      step={2}
      title="Here's what they actually did"
      subtitle="Every stint, every stop, exactly as it happened on the day."
    >
      <div className="mx-auto max-w-2xl rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6 sm:p-8">
        <div className="flex gap-1.5">
          {PLACEHOLDER_STINTS.map((stint) => (
            <div key={stint.label} className={`${stint.width} shrink-0`}>
              <div className="h-2.5 rounded-full bg-neutral-700" />
              <p className="mt-3 text-left text-[0.65rem] tracking-wider text-neutral-500 uppercase">
                {stint.label}
              </p>
              <p className="text-left text-xs text-neutral-600">{stint.span}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 h-24 rounded-lg border border-dashed border-neutral-800 sm:h-32">
          <p className="flex h-full items-center justify-center text-xs tracking-[0.2em] text-neutral-600 uppercase">
            Lap-time chart placeholder
          </p>
        </div>
      </div>
    </SceneFrame>
  )
}
