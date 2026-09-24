import { compoundById } from '../../lib/raceData'

/**
 * A strategy as a proportional bar: one segment per stint, sized by its lap count.
 * Shared by scene 2 (what happened) and scene 3 (what you changed), so the two read as
 * the same object.
 *
 * A stint only shows a compound when it has one to show. Actual stints never do —
 * Jolpica publishes no tire data — and neither does any opening stint, so those segments
 * are neutral and labelled with what is actually known: the lap range, and the pit-lane
 * time of the stop that ended them.
 *
 * @param {Array} stints   Rows from `buildStints`.
 * @param {boolean} showLabels  Labels under each segment.
 * @param {string} rowLabel     Caption shown to the left instead of per-segment labels.
 */
export default function StintBar({ stints, showLabels = true, rowLabel }) {
  const bar = (
    <div className="flex min-w-0 flex-1 gap-1">
      {stints.map((stint) => {
        const compound = stint.compound ? compoundById(stint.compound) : null
        const lapRange = `L${stint.startLap}–${stint.endLap}`

        return (
          <div
            key={stint.startLap}
            style={{ flexGrow: stint.laps, flexBasis: 0 }}
            className="min-w-0"
          >
            <div
              className={`h-2.5 rounded-full opacity-80 ${
                compound ? compound.dot : 'bg-neutral-600'
              }`}
            />
            {showLabels && (
              <>
                <p className="mt-2 truncate text-left text-[0.65rem] tracking-wider text-neutral-400 uppercase">
                  {compound ? compound.label : lapRange}
                </p>
                <p className="truncate text-left text-[0.65rem] text-neutral-400 tabular-nums">
                  {compound
                    ? lapRange
                    : stint.pitsAfter
                      ? `${stint.pitsAfter.duration_seconds.toFixed(1)}s stop`
                      : `${stint.laps} laps`}
                </p>
              </>
            )}
          </div>
        )
      })}
    </div>
  )

  if (!rowLabel) return bar

  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-left text-[0.65rem] tracking-wider text-neutral-400 uppercase">
        {rowLabel}
      </span>
      {bar}
    </div>
  )
}
