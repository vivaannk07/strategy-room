import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatLapTime } from '../../lib/raceData'

// Axis labels are 10px text, which needs the full 4.5:1 against the panel —
// neutral-400, the same floor the surrounding HTML labels use.
const AXIS_TEXT = '#a3a3a3'

/** Lap ticks that stay readable at 390px: every tenth lap, plus the last one. */
function lapTicks(laps) {
  const last = laps.at(-1)?.lap ?? 0
  const ticks = [1]
  for (let lap = 10; lap < last - 4; lap += 10) ticks.push(lap)
  if (last > 1) ticks.push(last)
  return ticks
}

/**
 * Whole-second bounds around the racing laps.
 *
 * The top is taken from the 90th percentile rather than the slowest lap: recorded timing
 * includes lap 1 and safety-car laps, several seconds off the pace, and scaling to those
 * would flatten the stints the chart exists to show. Laps above the bound run off the
 * top of the plot (`allowDataOverflow`).
 */
function paceDomain(laps) {
  const paces = laps
    .map((lap) => lap.pace_seconds)
    .filter((pace) => pace != null)
    .sort((a, b) => a - b)
  if (paces.length === 0) return [0, 1]

  const p90 = paces[Math.floor((paces.length - 1) * 0.9)]
  const top = Math.min(paces.at(-1), p90 + 1.5)
  return [Math.floor(paces[0] - 0.4), Math.ceil(top + 0.4)]
}

/** Four or five evenly spaced whole seconds — `1:24.0` reads, `1:24.3` doesn't. */
function paceTicks([min, max]) {
  const step = Math.max(1, Math.ceil((max - min) / 4))
  const ticks = []
  for (let value = min; value <= max; value += step) ticks.push(value)
  return ticks
}

function PaceTooltip({ active, payload }) {
  if (!active || !payload?.length) return null

  const row = payload[0].payload
  // Tyre age is knowable from the stop laps; the compound that produced it isn't.
  const age = `${row.tire_age} lap${row.tire_age === 1 ? '' : 's'} on this set`

  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-950/95 px-3 py-2 text-left">
      <p className="text-xs font-medium text-neutral-100">Lap {row.lap}</p>
      {row.lap_time_seconds != null && (
        <p className="mt-0.5 text-sm text-neutral-200 tabular-nums">
          {formatLapTime(row.lap_time_seconds, 3)}
        </p>
      )}
      <p className="mt-1 text-[0.7rem] text-neutral-400">{age}</p>
      {row.is_pit_lap && (
        <p className="mt-1 text-[0.7rem] text-red-400">Pit lap — left off the line</p>
      )}
    </div>
  )
}

/**
 * Recorded lap times over a race, with the real pit stops marked on the lap axis.
 *
 * Plots `pace_seconds`, which is null on each stop's in-lap and out-lap: the pit-lane
 * loss would compress every other lap into a flat line. The line bridges those laps and
 * the stops are drawn as markers instead, which is also how a timing screen reads.
 *
 * @param {string} id       Unique per chart instance — scopes the fill gradient.
 * @param {Array} laps      Rows from `buildPaceSeries`.
 * @param {Array} stops     Actual stops, `[{ lap, duration_seconds }]` — no compound.
 */
export default function LapPaceChart({ id, laps, stops, accent = '#ef4444', ariaLabel }) {
  const gradientId = `pace-fill-${id}`
  const yDomain = paceDomain(laps)

  return (
    <div className="h-full w-full" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={laps} margin={{ top: 22, right: 10, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={accent} stopOpacity={0.34} />
              <stop offset="100%" stopColor={accent} stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="#262626" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="lap"
            type="number"
            domain={['dataMin', 'dataMax']}
            ticks={lapTicks(laps)}
            tick={{ fill: AXIS_TEXT, fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: '#262626' }}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={yDomain}
            allowDataOverflow
            ticks={paceTicks(yDomain)}
            tickFormatter={(value) => formatLapTime(value)}
            tick={{ fill: AXIS_TEXT, fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip
            content={<PaceTooltip />}
            cursor={{ stroke: '#525252', strokeDasharray: '3 3' }}
          />

          {/*
            An actual stop carries no compound, so it gets a neutral marker labelled with
            the one other thing the data does give us: the pit-lane time.
          */}
          {stops.map((stop) => (
            <ReferenceLine
              key={stop.stop}
              x={stop.lap}
              stroke="#a3a3a3"
              strokeOpacity={0.75}
              strokeDasharray="4 3"
              label={{
                value: `L${stop.lap} · ${stop.duration_seconds.toFixed(1)}s`,
                position: 'top',
                fill: '#a3a3a3',
                fontSize: 10,
                letterSpacing: '0.08em',
              }}
            />
          ))}

          {/*
            Animation off: every scene is mounted from the start at opacity 0, so a
            mount animation would already have played by the time the scene scrolls in.
          */}
          <Area
            type="monotone"
            dataKey="pace_seconds"
            connectNulls
            stroke={accent}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            activeDot={{ r: 3, fill: accent, stroke: '#0a0a0a', strokeWidth: 1.5 }}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
