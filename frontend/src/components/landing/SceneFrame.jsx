/**
 * Shared chrome for landing scenes: step eyebrow, heading, supporting line,
 * and a slot for whatever placeholder (later, real) UI the scene shows.
 *
 * `data-scene-heading` marks each line of the heading, by kind, for the story
 * backdrop to keep its art out from behind — each kind at the strength it needs to
 * stay readable (see `StoryBackdrop`).
 */
export default function SceneFrame({ step, title, subtitle, children }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col items-center text-center">
      <p
        data-scene-heading="eyebrow"
        className="text-[0.7rem] font-medium tracking-[0.3em] text-red-500 uppercase"
      >
        Scene {String(step).padStart(2, '0')}
      </p>
      <h2
        data-scene-heading="title"
        className="mt-3 text-3xl font-semibold text-balance text-neutral-50 sm:text-5xl"
      >
        {title}
      </h2>
      {subtitle && (
        <p
          data-scene-heading="subtitle"
          className="mt-3 max-w-md text-sm text-pretty text-neutral-400 sm:mt-4 sm:max-w-lg sm:text-base"
        >
          {subtitle}
        </p>
      )}
      <div className="mt-8 w-full sm:mt-10">{children}</div>
    </div>
  )
}
