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
import { compoundById, formatLapTime } from '../../../lib/mockRaceData'

/** Lap ticks that stay readable at 390px: every tenth lap, plus the last one. */
function lapTicks(laps) {
  const last = laps.at(-1)?.lap ?? 0
  const ticks = [1]
  for (let lap = 10; lap < last - 4; lap += 10) ticks.push(lap)
  if (last > 1) ticks.push(last)
  return ticks
}

/** Whole-second bounds around the data, so the axis lands on round lap times. */
function paceDomain(laps) {
  const paces = laps.map((lap) => lap.pace_seconds)
  return [Math.floor(Math.min(...paces) - 0.4), Math.ceil(Math.max(...paces) + 0.4)]
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
  // Absent on the actual side and on any opening stint — tyre age is knowable from the
  // stop laps, the compound that produced it isn't.
  const compound = row.compound ? compoundById(row.compound) : null
  const age = `${row.tire_age} lap${row.tire_age === 1 ? '' : 's'} old`

  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-950/95 px-3 py-2 text-left">
      <p className="text-xs font-medium text-neutral-100">Lap {row.lap}</p>
      <p className="mt-0.5 text-sm text-neutral-200 tabular-nums">
        {formatLapTime(row.pace_seconds, 3)}
      </p>
      <p className="mt-1 flex items-center gap-1.5 text-[0.7rem] text-neutral-500">
        {compound && (
          <span className={`h-1.5 w-1.5 rounded-full ${compound.dot}`} />
        )}
        {compound ? `${compound.label} · ${age}` : age}
      </p>
      {row.is_pit_lap && (
        <p className="mt-1 text-[0.7rem] text-red-400">Pitted — pit-lane loss excluded</p>
      )}
    </div>
  )
}

/**
 * Lap pace over a race, with the pit stops marked on the lap axis.
 *
 * Plots `pace_seconds`, not `lap_time_seconds`: a pit lap carries ~21s of pit-lane loss,
 * and including it would compress every other lap in the race into a flat line. The
 * stops are shown as markers instead, which is also how a timing screen reads.
 *
 * @param {string} id            Unique per chart instance — scopes the fill gradient.
 * @param {Array} laps           Rows from `buildLapTimes`.
 * @param {Array} strategy       Stops to mark, `[{ lap, duration_seconds, compound? }]`.
 *                               `compound` is present only on user-chosen stops.
 * @param {[number, number]} domain  Shared y-axis bounds, so two charts compare honestly.
 * @param {'full'|'short'} stopLabels  `full` adds the compound name to the marker.
 */
export default function LapPaceChart({
  id,
  laps,
  strategy,
  accent = '#ef4444',
  domain,
  stopLabels = 'full',
  ariaLabel,
}) {
  const gradientId = `pace-fill-${id}`
  const yDomain = domain ?? paceDomain(laps)

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
            ticks={lapTicks(laps)}
            tick={{ fill: '#737373', fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: '#262626' }}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={yDomain}
            ticks={paceTicks(yDomain)}
            tickFormatter={(value) => formatLapTime(value)}
            tick={{ fill: '#737373', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip
            content={<PaceTooltip />}
            cursor={{ stroke: '#525252', strokeDasharray: '3 3' }}
          />

          {strategy.map((stop) => {
            // A stop the user chose carries a compound and is marked in its colour. An
            // actual stop carries none — it gets a neutral marker labelled with the one
            // other thing the data does give us, the pit-lane time.
            const compound = stop.compound ? compoundById(stop.compound) : null
            const color = compound ? compound.color : '#a3a3a3'
            // Compound is set in caps to match the scene's other labels; a duration
            // reads as a number, so it keeps its lowercase unit.
            const detail = compound
              ? compound.label.toUpperCase()
              : `${stop.duration_seconds.toFixed(1)}s`

            return (
              <ReferenceLine
                key={stop.lap}
                x={stop.lap}
                stroke={color}
                strokeOpacity={0.75}
                strokeDasharray="4 3"
                label={{
                  value:
                    stopLabels === 'full' ? `L${stop.lap} · ${detail}` : `L${stop.lap}`,
                  position: 'top',
                  fill: color,
                  fontSize: 10,
                  letterSpacing: '0.08em',
                }}
              />
            )
          })}

          {/*
            Animation off: every scene is mounted from the start at opacity 0, so a
            mount animation would already have played by the time the scene scrolls in.
          */}
          <Area
            type="monotone"
            dataKey="pace_seconds"
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
