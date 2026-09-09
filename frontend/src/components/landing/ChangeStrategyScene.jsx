import SceneFrame from './SceneFrame'

const COMPOUNDS = [
  { label: 'Soft', tone: 'border-red-500/60 text-red-400' },
  { label: 'Medium', tone: 'border-yellow-400/60 text-yellow-300' },
  { label: 'Hard', tone: 'border-neutral-400/60 text-neutral-200' },
]

/** Scene 3 — placeholder pit-lap slider and compound picker. */
export default function ChangeStrategyScene() {
  return (
    <SceneFrame
      step={3}
      title="Now change the call"
      subtitle="Move the stop. Pick a different tyre. Ask the question the pit wall didn't."
    >
      <div className="mx-auto max-w-2xl rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6 sm:p-8">
        <div className="flex items-center justify-between text-[0.65rem] tracking-wider text-neutral-500 uppercase">
          <span>Lap 1</span>
          <span className="text-neutral-300">Pit on lap 24</span>
          <span>Lap 53</span>
        </div>
        <div className="relative mt-3 h-2.5 rounded-full bg-neutral-800">
          <div className="absolute inset-y-0 left-0 w-[45%] rounded-full bg-red-500/70" />
          <div className="absolute top-1/2 left-[45%] h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-red-500 bg-neutral-950" />
        </div>
        <div className="mt-8 flex flex-wrap justify-center gap-2.5">
          {COMPOUNDS.map((compound) => (
            <span
              key={compound.label}
              className={`rounded-full border px-4 py-1.5 text-xs tracking-wider uppercase ${compound.tone}`}
            >
              {compound.label}
            </span>
          ))}
        </div>
        <p className="mt-6 text-xs tracking-[0.2em] text-neutral-600 uppercase">
          Controls placeholder
        </p>
      </div>
    </SceneFrame>
  )
}
