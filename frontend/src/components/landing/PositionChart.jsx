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

export const ACTUAL_COLOR = '#a3a3a3'
export const HYPOTHETICAL_COLOR = '#ef4444'

// Axis labels are 10px text, which needs the full 4.5:1 against the panel —
// neutral-400, the same floor the surrounding HTML labels use. It lands on the
// same grey as ACTUAL_COLOR through the palette, not through any relation to it.
const AXIS_TEXT = '#a3a3a3'

/**
 * The two sides of the comparison, each drawn in its own panel. Both read the same
 * `rows`, so only the key, the styling and the stop markers differ.
 */
const SERIES = {
  actual: {
    dataKey: 'actual_position',
    color: ACTUAL_COLOR,
    strokeWidth: 1.5,
    // The real stops carry no compound — nothing publishes what the car fitted —
    // so they're marked in the line's own grey.
    stopColor: () => ACTUAL_COLOR,
  },
  hypothetical: {
    dataKey: 'hypothetical_position',
    color: HYPOTHETICAL_COLOR,
    strokeWidth: 2,
    // The hypothetical stops do, so each is marked in the colour of the tyre
    // going on rather than the line's red.
    stopColor: (stop) => compoundById(stop.compound_in).color,
  },
}

/**
 * Lap ticks that stay readable in a half-width panel.
 *
 * These panels are half the stage wide at every breakpoint, so on a phone the plot
 * is only ~130px across — every tenth lap would put six labels in that space and
 * they'd collide. The step is rounded up to a multiple of ten until at most
 * `MAX_LAP_TICKS` land, and the last lap always gets one so the axis reads end to end.
 */
const MAX_LAP_TICKS = 4

function lapTicks(rows) {
  const last = rows.at(-1)?.lap ?? 0
  const step = Math.max(10, Math.ceil(last / (MAX_LAP_TICKS * 10)) * 10)
  const ticks = [1]
  // Anything within half a step of the end would sit on top of the last tick.
  for (let lap = step; lap < last - step / 2; lap += step) ticks.push(lap)
  if (last > 1) ticks.push(last)
  return ticks
}

/**
 * Both panels show both numbers, so the hover reads as one comparison however it was
 * triggered — which is the point of syncing them. The row carries both positions
 * regardless of which line this chart draws.
 */
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
 * One side's track position per lap, P1 at the top — the `lap_by_lap` block of the
 * `POST /api/simulate` response, which is the median run rather than all of them.
 *
 * Scene 5 renders two of these side by side, one per `series`, mirroring the pair of
 * stat cards above them. Both are handed the same `rows`, which is what makes them
 * comparable: the position axis is scaled to the deepest either side ran, so it comes
 * out identical in both panels, and a shared `syncId` puts Recharts' cursor and tooltip
 * on the same lap in both whichever one the pointer is over.
 *
 * @param {Array} rows      `[{ lap, hypothetical_position, actual_position }]`, with a
 *                          position of 0 (no timing recorded) as null.
 * @param {string} series   Which side to draw — `actual` or `hypothetical`.
 * @param {Array} stops     That side's stops, marked on the lap axis. The real ones are
 *                          `[{ stop, lap, duration_seconds }]`, the hypothetical
 *                          `[{ lap, compound_in }]`.
 * @param {string} syncId   Shared by both panels to sync the hover.
 */
export default function PositionChart({ rows, series, stops, syncId, ariaLabel }) {
  const { dataKey, color, strokeWidth, stopColor } = SERIES[series]
  const deepest = Math.max(
    1,
    ...rows.flatMap((row) => [row.hypothetical_position, row.actual_position]),
  )
  const positionTicks = [1, 5, 10, 15, 20].filter((position) => position <= deepest)

  return (
    <div className="h-full w-full" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={rows}
          syncId={syncId}
          margin={{ top: 16, right: 10, bottom: 0, left: 0 }}
        >
          <CartesianGrid stroke="#262626" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="lap"
            type="number"
            domain={['dataMin', 'dataMax']}
            ticks={lapTicks(rows)}
            tick={{ fill: AXIS_TEXT, fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: '#262626' }}
          />
          <YAxis
            reversed
            domain={[1, deepest]}
            ticks={positionTicks}
            allowDecimals={false}
            tickFormatter={(value) => `P${value}`}
            tick={{ fill: AXIS_TEXT, fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={28}
          />
          <Tooltip
            content={<PositionTooltip />}
            cursor={{ stroke: '#525252', strokeDasharray: '3 3' }}
          />

          {/* Only this side's stops land here, so each panel has its top edge free
              for them. They label above the plot rather than under the lap axis:
              a stop lap and a tick lap are the same axis, so in a panel this narrow
              the two labels sat on top of each other. */}
          {stops.map((stop) => (
            <ReferenceLine
              key={stop.lap}
              x={stop.lap}
              stroke={stopColor(stop)}
              strokeOpacity={0.6}
              strokeDasharray="2 3"
              label={{
                value: `L${stop.lap}`,
                position: 'top',
                fill: stopColor(stop),
                fontSize: 10,
              }}
            />
          ))}

          {/* Animation off, for the same reason as <LapPaceChart>: scenes mount hidden. */}
          <Line
            type="stepAfter"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={strokeWidth}
            dot={false}
            isAnimationActive={false}
            activeDot={{ r: 3, fill: color, stroke: '#0a0a0a', strokeWidth: 1.5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
