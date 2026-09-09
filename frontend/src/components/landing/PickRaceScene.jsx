import SceneFrame from './SceneFrame'

/** Scene 1 — placeholder track outline standing in for the race selector. */
export default function PickRaceScene() {
  return (
    <SceneFrame
      step={1}
      title="Pick a race"
      subtitle="Any Grand Prix on record. The one you still argue about."
    >
      <div className="mx-auto flex max-w-xl flex-col items-center rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6 sm:p-8">
        <svg
          viewBox="0 0 320 180"
          role="img"
          aria-label="Placeholder circuit outline"
          className="h-32 w-full text-neutral-600 sm:h-40"
        >
          <path
            d="M40 140 C 20 110, 30 60, 70 48 L 150 26 C 190 16, 220 34, 226 62 L 236 104 C 242 132, 226 150, 198 150 L 120 150 C 96 150, 92 132, 106 118 L 140 84"
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="40" cy="140" r="7" className="fill-red-500" />
        </svg>
        <p className="mt-5 text-xs tracking-[0.2em] text-neutral-500 uppercase">
          Circuit placeholder
        </p>
      </div>
    </SceneFrame>
  )
}
