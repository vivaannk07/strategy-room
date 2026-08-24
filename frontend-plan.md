# Frontend Plan

Four screens. React + Vite, Tailwind for styling, Framer Motion for transitions/interactions, Recharts for charts.

## 1. Race Selector
- Grid/list of past races from `GET /api/races`
- Each card: season, round, race name, `circuit_name`, date
- Filter by season
- Clicking a race loads it and moves to Strategy Builder — carry `season` + `round` through
  as the selected race, not a single id string

## 2. Strategy Builder
- Loads race detail via `GET /api/races/{season}/{round}`
- Driver dropdown to pick which driver's strategy to change
- Lap timeline (1 to `total_laps`) showing the driver's **actual** pit stops as fixed reference markers
  — lap and duration only. Actual stints have **no compound to display**: Jolpica doesn't
  publish tire data, so don't design a UI that labels the real stints soft/medium/hard
- User drags/adds a marker to set a hypothetical pit lap, picks a tire compound for the new
  stint. Compound is a user choice on the hypothetical strategy only
- "Run simulations" button — sends `season`, `round`, `driver_id` and the strategy to
  `POST /api/simulate`

## 3. Simulation Results
- Shown after the simulate call resolves
- Headline numbers: simulated mean/median race time, delta vs. actual (color-coded — green faster, red slower)
- Finish position distribution as a bar chart (Recharts)
- Button through to Compare view for lap-by-lap detail
- Handle the no-baseline case: a driver who retired has
  `actual_finish_time_seconds: null`, so there's no delta to show. Fall back to comparing
  positions, or exclude retirees from the driver dropdown in §2

## 4. Compare View
- Recharts line chart: track position (y-axis, inverted so P1 is at top) over lap number (x-axis)
- Two lines: hypothetical strategy vs. actual race, for the selected driver
- Vertical markers on pit laps (both hypothetical and actual, visually distinguishable)
- The "you would've undercut Leclerc on lap 16" payoff screen

## Shared/global
- Framer Motion for screen transitions and the pit-marker drag interaction
- Loading states for both API calls — race detail fetch can be slow on first load per race (triggers a Jolpica fetch + cache); simulate call runs 500 iterations server-side