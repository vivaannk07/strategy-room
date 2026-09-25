# E2E / visual verification scripts

Playwright scripts used to verify the landing ScrollStory against the
mobile-parity rules in `CLAUDE.md`. Each file exports a single
`async (page) => { ... }` and is run through the Playwright MCP
`run_code` tool (not `playwright test` — there is no test runner wired up).

Start the dev server first:

    npm run dev        # http://localhost:5173

## verify3.js

The main verification pass. Sweeps all 8 combinations of:

| Axis            | Values                          |
|-----------------|---------------------------------|
| Viewport        | 390x844 (phone), 1280x800 (desktop) |
| ViewTimeline    | available, deleted (JS fallback) |
| Reduced motion  | no-preference, reduce           |

For each combination it scrolls the story, asserts heading contrast and
layer tints, and writes screenshots named `v3-<tag>-<n>.png`, where the
tag is e.g. `d-vt`, `m-novt-rm`. Returns a results object with per-config
contrast numbers and a log.

Output goes to `.playwright-mcp/` by default (gitignored). Override with:

    SHOT_DIR=some/other/dir

The 10 screenshots kept in `.playwright-mcp/` as proof of testing came
from this script.

## track-harness.js

Runs one full pick-race -> change-strategy -> simulate flow and checks the
lap-by-lap track chart. It is parameterised: a `CFG` line must be
prepended at run time.

    const CFG = { w, h, driverName, compound, lap, noVT, tag, shots };

## case-d-novt.js

A worked example of the above — `track-harness.js` with a CFG already
prepended (Sainz, hard, lap 19, desktop, ViewTimeline deleted). Copy it
and edit the CFG to add cases.
