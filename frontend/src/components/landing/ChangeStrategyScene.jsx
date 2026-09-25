import SceneFrame from './SceneFrame'
import PickFirst from './PickFirst'
import StintBar from './StintBar'
import {
  COMPOUNDS,
  KEPT_STOP_COMPOUND,
  buildHypotheticalStrategy,
  buildStints,
  compoundById,
  driverLastLap,
  pitLapRange,
} from '../../lib/raceData'

/** Where `lap` sits along the slider, as a percentage. */
function percentOf(lap, { min, max }) {
  // A one-lap range has nowhere to go; pin to the start rather than divide by zero.
  return max === min ? 0 : ((lap - min) / (max - min)) * 100
}

/**
 * Scene 3 — the controls. Moves the first stop and picks what the car goes onto.
 *
 * State is owned by <LandingPage> rather than here: scenes 4 and 5 send the same call to
 * `POST /api/simulate` and read the result back.
 *
 * @param {object|null} race    GET /api/races/{season}/{round} response.
 * @param {object|null} driver  One of `race.drivers`.
 * @param {{lap: number, compound: string}} strategy  The user's current call.
 * @param {Function} onChange  Patches the call, e.g. `onChange({ lap: 20 })`.
 */
export default function ChangeStrategyScene({ race, driver, strategy, onChange }) {
  const frame = (content) => (
    <SceneFrame
      step={3}
      title="Now change the call"
      subtitle="Move the stop. Pick a different tyre. Ask the question the pit wall didn't."
    >
      {content}
    </SceneFrame>
  )

  if (!race || !driver) return frame(<PickFirst />)

  // Clamped to the real race: stops short of the driver's second real stop, or of their
  // last lap — which is the race length unless they retired.
  const range = pitLapRange(driver, race.total_laps)
  if (range.max < range.min) {
    return frame(
      <PickFirst>
        {driver.driver_name} completed {driver.actual_laps_completed} lap
        {driver.actual_laps_completed === 1 ? '' : 's'}, which leaves no lap to put a stop on.
        Pick another driver in scene 1.
      </PickFirst>,
    )
  }

  const compound = compoundById(strategy.compound)
  const actualFirstStop = driver.actual_pit_stops[0] ?? null
  const keptStops = driver.actual_pit_stops.slice(1)
  const lapsMoved = actualFirstStop ? strategy.lap - actualFirstStop.lap : null
  const lastLap = driverLastLap(driver, race.total_laps)

  // Neutral by construction: an actual strategy has no compound on any of its stints.
  const actualStints = buildStints(driver.actual_pit_stops, lastLap)
  // The preview is exactly the strategy scene 4 sends, so every stop names a compound.
  const stints = buildStints(buildHypotheticalStrategy(driver, strategy), lastLap)

  return frame(
    <div className="mx-auto max-w-2xl rounded-2xl border border-neutral-800 bg-neutral-900 p-5 sm:p-7">
      <div className="flex items-baseline justify-between gap-4 text-left">
        <div>
          <p className="text-[0.65rem] tracking-[0.2em] text-neutral-400 uppercase">
            {actualFirstStop ? 'First stop' : 'Add a stop'}
          </p>
          <p className="mt-1 text-3xl font-semibold text-neutral-50 tabular-nums sm:text-4xl">
            Lap {strategy.lap}
          </p>
        </div>
        <p className="text-right text-xs text-neutral-400">
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
          min={range.min}
          max={range.max}
          step={1}
          value={strategy.lap}
          onChange={(event) => onChange({ lap: Number(event.target.value) })}
          aria-label="Lap to pit on"
          // The filled half of the track is painted as a background image rather
          // than a background colour: a native range input gives no hook for
          // "progress so far" that works in every engine, and the input itself is
          // now 44px tall (a thumb-sized hit strip for a finger) with the visible
          // 10px track drawn centred inside it via `background-size`/`position`.
          style={{
            backgroundImage: `linear-gradient(to right, #ef4444 ${percentOf(
              strategy.lap,
              range,
            )}%, #262626 ${percentOf(strategy.lap, range)}%)`,
          }}
          className="h-11 w-full cursor-pointer appearance-none bg-[length:100%_10px] bg-center bg-no-repeat [background-clip:content-box] outline-none [border-radius:9999px] focus-visible:ring-2 focus-visible:ring-red-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-red-500 [&::-moz-range-thumb]:bg-neutral-950 [&::-moz-range-track]:h-2.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:h-2.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:mt-[-5px] [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-red-500 [&::-webkit-slider-thumb]:bg-neutral-950"
        />

        <div className="relative mt-2 h-8">
          <span className="absolute left-0 text-[0.65rem] text-neutral-400 tabular-nums">
            Lap {range.min}
          </span>
          <span className="absolute right-0 text-[0.65rem] text-neutral-400 tabular-nums">
            Lap {range.max}
          </span>
          {/* Where the real stop came, so the user can see what they moved away from. */}
          {actualFirstStop && (
            <span
              className="absolute -translate-x-1/2 text-[0.65rem] whitespace-nowrap text-neutral-400"
              style={{ left: `${percentOf(actualFirstStop.lap, range)}%` }}
            >
              <span className="mx-auto mb-1 block h-2 w-px bg-neutral-600" />
              actual · L{actualFirstStop.lap}
            </span>
          )}
        </div>
      </div>

      <fieldset className="mt-3">
        <legend className="mx-auto text-[0.65rem] tracking-[0.2em] text-neutral-400 uppercase">
          Fit which tyre
        </legend>
        <div className="mt-3 flex flex-wrap justify-center gap-2.5">
          {COMPOUNDS.map((option) => {
            const isSelected = option.id === strategy.compound

            return (
              <label key={option.id} className="tap-target flex cursor-pointer items-center">
                <input
                  type="radio"
                  name="compound"
                  value={option.id}
                  checked={isSelected}
                  onChange={() => onChange({ compound: option.id })}
                  className="peer sr-only"
                />
                <span
                  className={`block w-full rounded-full border px-4 py-2 text-xs tracking-wider uppercase transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-red-500/60 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-neutral-950 ${
                    isSelected
                      ? option.chip
                      : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200 active:border-neutral-500 active:text-neutral-200'
                  }`}
                >
                  {option.label}
                </span>
              </label>
            )
          })}
        </div>
        <p className="mt-3 text-xs text-neutral-400">
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
        <StintBar stints={actualStints} showLabels={false} rowLabel="Actual" />
        <StintBar stints={stints} showLabels={false} rowLabel="Your call" />
        {keptStops.length > 0 && (
          <p className="text-left text-[0.7rem] text-neutral-400">
            {keptStops.length === 1 ? 'The later stop stays' : 'Later stops stay'} on the real
            lap{keptStops.length === 1 ? '' : 's'} (
            {keptStops.map((stop) => `L${stop.lap}`).join(', ')}), modeled on{' '}
            {compoundById(KEPT_STOP_COMPOUND).label.toLowerCase()}s.
          </p>
        )}
      </div>
    </div>,
  )
}
