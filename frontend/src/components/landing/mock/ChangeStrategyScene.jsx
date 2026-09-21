import { useMemo } from 'react'
import SceneFrame from '../SceneFrame'
import StintBar from '../StintBar'
import {
  ACTUAL_STRATEGY,
  COMPOUNDS,
  HYPOTHETICAL_STRATEGY,
  MOCK_RACE,
  buildStints,
  compoundById,
} from '../../../lib/mockRaceData'

// Neutral by construction: an actual strategy has no compound on any of its stints.
const ACTUAL_STINTS = buildStints(ACTUAL_STRATEGY)

export const MIN_PIT_LAP = 2

/** Where `lap` sits along a slider running from `MIN_PIT_LAP` to `maxPitLap`, as a percentage. */
function percentOf(lap, maxPitLap) {
  return ((lap - MIN_PIT_LAP) / (maxPitLap - MIN_PIT_LAP)) * 100
}

/**
 * Scene 3 — the controls. Moves the first stop and picks what the car goes onto.
 *
 * State is owned by <LandingPage> rather than here: scene 4 reads the same call back
 * out, and next pass it becomes the `strategy` body of `POST /api/simulate`.
 *
 * @param {{lap: number, compound: string}} strategy  The user's current call.
 * @param {Function} onChange  Patches the call, e.g. `onChange({ lap: 20 })`.
 */
export default function ChangeStrategyScene({ strategy, onChange }) {
  const compound = compoundById(strategy.compound)

  // Either can be missing: 1-stop and 0-stop races are common.
  const actualFirstStop = ACTUAL_STRATEGY[0] ?? null
  const actualSecondStop = ACTUAL_STRATEGY[1] ?? null
  /** The later stop, kept as it was — carried over from the hypothetical, compound and all. */
  const keptSecondStop = actualSecondStop ? (HYPOTHETICAL_STRATEGY[1] ?? null) : null

  /**
   * The first stop is the one the user moves, so the slider stops short of the second —
   * the stops can't cross, and a range that can't produce an invalid strategy needs no
   * validation message. With no second stop to run into, it stops short of the final lap
   * so the new tyre always gets at least one lap.
   */
  const maxPitLap = (actualSecondStop?.lap ?? MOCK_RACE.total_laps) - 1
  const lapsMoved = actualFirstStop ? strategy.lap - actualFirstStop.lap : null

  // The preview is a hypothetical strategy, so every stop names a compound: the one the
  // user just picked, and the one carried by the stop they left alone (if there is one).
  const stints = useMemo(
    () =>
      buildStints([
        {
          ...actualFirstStop,
          lap: strategy.lap,
          compound: strategy.compound,
        },
        ...(keptSecondStop ? [keptSecondStop] : []),
      ]),
    [actualFirstStop, keptSecondStop, strategy.lap, strategy.compound],
  )

  return (
    <SceneFrame
      step={3}
      title="Now change the call"
      subtitle="Move the stop. Pick a different tyre. Ask the question the pit wall didn't."
    >
      <div className="mx-auto max-w-2xl rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5 sm:p-7">
        <div className="flex items-baseline justify-between gap-4 text-left">
          <div>
            <p className="text-[0.65rem] tracking-[0.2em] text-neutral-500 uppercase">
              First stop
            </p>
            <p className="mt-1 text-3xl font-semibold text-neutral-50 tabular-nums sm:text-4xl">
              Lap {strategy.lap}
            </p>
          </div>
          <p className="text-right text-xs text-neutral-500">
            {lapsMoved === null
              ? 'They never stopped on the day'
              : lapsMoved === 0
                ? 'The call they actually made'
                : `${Math.abs(lapsMoved)} lap${Math.abs(lapsMoved) === 1 ? '' : 's'} ${
                    lapsMoved > 0 ? 'later' : 'earlier'
                  } than the real stop`}
          </p>
        </div>

        <div className="mt-5">
          <input
            type="range"
            min={MIN_PIT_LAP}
            max={maxPitLap}
            step={1}
            value={strategy.lap}
            onChange={(event) => onChange({ lap: Number(event.target.value) })}
            aria-label="Lap to pit on"
            // The filled half of the track is painted as a gradient: a native range
            // input gives no hook for "progress so far" that works in every engine.
            style={{
              background: `linear-gradient(to right, #ef4444 ${percentOf(
                strategy.lap,
                maxPitLap,
              )}%, #262626 ${percentOf(strategy.lap, maxPitLap)}%)`,
            }}
            className="h-2.5 w-full cursor-pointer appearance-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-red-500/60 focus-visible:ring-offset-4 focus-visible:ring-offset-neutral-950 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-red-500 [&::-moz-range-thumb]:bg-neutral-950 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-red-500 [&::-webkit-slider-thumb]:bg-neutral-950 [&::-webkit-slider-thumb]:shadow-[0_0_0_4px_rgba(239,68,68,0.18)]"
          />

          <div className="relative mt-2 h-8">
            <span className="absolute left-0 text-[0.65rem] text-neutral-600 tabular-nums">
              Lap {MIN_PIT_LAP}
            </span>
            <span className="absolute right-0 text-[0.65rem] text-neutral-600 tabular-nums">
              Lap {maxPitLap}
            </span>
            {/* Where the real stop came, so the user can see what they moved away from. */}
            {actualFirstStop && (
              <span
                className="absolute -translate-x-1/2 text-[0.65rem] whitespace-nowrap text-neutral-500"
                style={{ left: `${percentOf(actualFirstStop.lap, maxPitLap)}%` }}
              >
                <span className="mx-auto mb-1 block h-2 w-px bg-neutral-600" />
                actual · L{actualFirstStop.lap}
              </span>
            )}
          </div>
        </div>

        <fieldset className="mt-3">
          <legend className="mx-auto text-[0.65rem] tracking-[0.2em] text-neutral-500 uppercase">
            Fit which tyre
          </legend>
          <div className="mt-3 flex flex-wrap justify-center gap-2.5">
            {COMPOUNDS.map((option) => {
              const isSelected = option.id === strategy.compound

              return (
                <label key={option.id} className="cursor-pointer">
                  <input
                    type="radio"
                    name="compound"
                    value={option.id}
                    checked={isSelected}
                    onChange={() => onChange({ compound: option.id })}
                    className="peer sr-only"
                  />
                  <span
                    className={`block rounded-full border px-4 py-1.5 text-xs tracking-wider uppercase transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-red-500/60 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-neutral-950 ${
                      isSelected
                        ? option.chip
                        : 'border-neutral-700 text-neutral-500 hover:border-neutral-500 hover:text-neutral-300'
                    }`}
                  >
                    {option.label}
                  </span>
                </label>
              )
            })}
          </div>
          <p className="mt-3 text-xs text-neutral-500">
            {compound.label} runs {compound.ratio.toFixed(1)}× the measured degradation
            {compound.freshOffset === 0
              ? ''
              : `, ${Math.abs(compound.freshOffset).toFixed(2)}s/lap ${
                  compound.freshOffset < 0 ? 'quicker' : 'slower'
                } fresh`}
            .
          </p>
        </fieldset>

        <div className="mt-6 space-y-3 border-t border-neutral-800 pt-5">
          <StintBar stints={ACTUAL_STINTS} showLabels={false} rowLabel="Actual" />
          <StintBar stints={stints} showLabels={false} rowLabel="Your call" />
        </div>
      </div>
    </SceneFrame>
  )
}
