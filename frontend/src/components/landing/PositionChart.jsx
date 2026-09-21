import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { compoundById } from '../../lib/raceData'

const ACTUAL_COLOR = '#a3a3a3'
const HYPOTHETICAL_COLOR = '#ef4444'

/** Lap ticks that stay readable at 390px: every tenth lap, plus the last one. */
function lapTicks(rows) {
  const last = rows.at(-1)?.lap ?? 0
  const ticks = [1]
  for (let lap = 10; lap < last - 4; lap += 10) ticks.push(lap)
  if (last > 1) ticks.push(last)
  return ticks
}

function PositionTooltip({ active, payload }) {
  if (!active || !payload?.length) return null

  const row = payload[0].payload
  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-950/95 px-3 py-2 text-left">
      <p className="text-xs font-medium text-neutral-100">Lap {row.lap}</p>
      {row.hypothetical_position != null && (
        <p className="mt-1 text-[0.7rem] tabular-nums" style={{ color: HYPOTHETICAL_COLOR }}>
          Your call · P{row.hypothetical_position}
        </p>
      )}
      {row.actual_position != null && (
        <p className="text-[0.7rem] tabular-nums" style={{ color: ACTUAL_COLOR }}>
          Actual · P{row.actual_position}
        </p>
      )}
    </div>
  )
}

/**
 * Track position per lap for both strategies, P1 at the top — the `lap_by_lap` block of
 * the `POST /api/simulate` response, which is the median run rather than all of them.
 *
 * Stops are marked on the lap axis for both sides and told apart the same way the lines
 * are: the actual stops in grey with their lap along the bottom, the hypothetical ones in
 * their compound's colour with their lap along the top.
 *
 * @param {Array} rows              `[{ lap, hypothetical_position, actual_position }]`,
 *                                  with a position of 0 (no timing recorded) as null.
 * @param {Array} actualStops       `[{ stop, lap, duration_seconds }]` — no compound.
 * @param {Array} hypotheticalStops `[{ lap, compound_in }]`.
 */
export default function PositionChart({ rows, actualStops, hypotheticalStops, ariaLabel }) {
  const deepest = Math.max(
    1,
    ...rows.flatMap((row) => [row.hypothetical_position, row.actual_position]),
  )
  const positionTicks = [1, 5, 10, 15, 20].filter((position) => position <= deepest)

  return (
    <div className="h-full w-full" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 22, right: 10, bottom: 14, left: 0 }}>
          <CartesianGrid stroke="#262626" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="lap"
            type="number"
            domain={['dataMin', 'dataMax']}
            ticks={lapTicks(rows)}
            tick={{ fill: '#737373', fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: '#262626' }}
          />
          <YAxis
            reversed
            domain={[1, deepest]}
            ticks={positionTicks}
            allowDecimals={false}
            tickFormatter={(value) => `P${value}`}
            tick={{ fill: '#737373', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={32}
          />
          <Tooltip
            content={<PositionTooltip />}
            cursor={{ stroke: '#525252', strokeDasharray: '3 3' }}
          />

          {actualStops.map((stop) => (
            <ReferenceLine
              key={`actual-${stop.stop}`}
              x={stop.lap}
              stroke={ACTUAL_COLOR}
              strokeOpacity={0.5}
              strokeDasharray="2 3"
              label={{
                value: `L${stop.lap}`,
                position: 'insideBottom',
                offset: -14,
                fill: ACTUAL_COLOR,
                fontSize: 10,
              }}
            />
          ))}
          {hypotheticalStops.map((stop) => {
            const { color } = compoundById(stop.compound_in)
            return (
              <ReferenceLine
                key={`hypothetical-${stop.lap}`}
                x={stop.lap}
                stroke={color}
                strokeOpacity={0.75}
                strokeDasharray="4 3"
                label={{ value: `L${stop.lap}`, position: 'top', fill: color, fontSize: 10 }}
              />
            )
          })}

          {/* Animation off, for the same reason as <LapPaceChart>: scenes mount hidden. */}
          <Line
            type="stepAfter"
            dataKey="actual_position"
            stroke={ACTUAL_COLOR}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="stepAfter"
            dataKey="hypothetical_position"
            stroke={HYPOTHETICAL_COLOR}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            activeDot={{ r: 3, fill: HYPOTHETICAL_COLOR, stroke: '#0a0a0a', strokeWidth: 1.5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
