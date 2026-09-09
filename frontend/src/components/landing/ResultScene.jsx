import SceneFrame from './SceneFrame'

const PANELS = [
  { key: 'actual', label: 'What happened', accent: 'text-neutral-400' },
  { key: 'hypothetical', label: 'What if', accent: 'text-red-400' },
]

/** Scene 5 — placeholder for the hypothetical-vs-actual split view. */
export default function ResultScene() {
  return (
    <SceneFrame
      step={5}
      title="Hypothetical vs. actual"
      subtitle="Where the two races diverge, and the lap it stopped being close."
    >
      <div className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-2 sm:gap-4">
        {PANELS.map((panel) => (
          <div
            key={panel.key}
            className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5 sm:p-6"
          >
            <p
              className={`text-[0.65rem] tracking-[0.2em] uppercase ${panel.accent}`}
            >
              {panel.label}
            </p>
            <p className="mt-3 text-4xl font-semibold text-neutral-100 tabular-nums">
              P—
            </p>
            <div className="mt-4 h-20 rounded-lg border border-dashed border-neutral-800 sm:h-24" />
          </div>
        ))}
      </div>
      <p className="mt-6 text-xs tracking-[0.2em] text-neutral-600 uppercase">
        Split view placeholder
      </p>
    </SceneFrame>
  )
}
