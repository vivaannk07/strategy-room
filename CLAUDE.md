# Strategy Room

## What this is
A full-stack web app where a user picks a real past Formula 1 race, changes a driver's pit-stop strategy (which lap they pit, which tire compound they switch to), and sees a simulated outcome compared against what actually happened in that race.

## Tech stack
**Frontend**
- React + Vite
- Tailwind CSS
- Framer Motion (animations)
- Recharts (position/time comparison charts)

**Backend**
- FastAPI (Python)
- PostgreSQL (caches race data locally so we're not hitting the external API on every request)

**Data source**
- Jolpica API — free public F1 statistics API, actively maintained successor to Ergast. No API key required. Base URL: `https://api.jolpi.ca/ergast/f1`

## How the app works (high level)
1. User picks a past race from a list.
2. User picks a driver from that race and changes their pit strategy — lap number(s) and tire compound(s) — on a timeline UI.
3. Backend re-simulates the race lap by lap under the new strategy using tire degradation curves + a pit-stop time penalty, and runs ~500 Monte Carlo iterations to account for safety-car randomness.
4. Frontend shows the simulated result (finish time/position) against the real result, plus a lap-by-lap track-position chart comparing both.

Full simulation logic: see `simulation-logic.md`.
Tire degradation derivation (Step 0 of the sim): see `degradation-model.md`.
Full API surface: see `api-contract.md`.
Full schema: see `data-model.md`.
Screen-by-screen frontend plan: see `frontend-plan.md`.

(These live at the project root, not in a `docs/` subfolder.)

## Workflow / conventions
- Prompts are written as numbered, batched steps and run through the `claude` command in PowerShell.
- Review every change before committing — don't auto-commit.
- Commits happen manually through GitHub Desktop, not from the CLI.
- Keep responses direct — don't re-explain things already covered in this file.

## Folder structure (target)

## Current status
Backend implemented through the simulation endpoints, plus a read-only per-driver laps route (see `api-contract.md`). Frontend: Vite + Tailwind v4 + Framer Motion, with a scroll-scrubbed landing flow — `src/components/ScrollStory.jsx` (reusable pinned/crossfade engine) driving five scenes in `src/components/landing/`, mounted via `src/pages/LandingPage.jsx`. The landing flow is wired to the real API end-to-end (race list → race detail/drivers → driver laps → `POST /api/simulate`) through `src/lib/api.js` and `src/lib/useApiResource.js`. `?mock=true` instead mounts `src/pages/MockLandingPage.jsx` — frozen copies of the pre-wiring scenes in `src/components/landing/mock/`, fed by `src/lib/mockRaceData.js`, no network calls — for offline dev/demos. Screens 1–4 from `frontend-plan.md` are not built as separate screens, and there's no router installed.

## Mobile parity (applies to every change)
- Every UI change, animation, and scroll effect must feel the same on phone as on desktop. Not a reduced version, the same experience adapted to the screen.
- Test every change at two viewports using Playwright MCP: 390x844 (phone) and 1280x800 (desktop). Report results for both. A change is not done until both pass.
- Use svh/dvh instead of vh for full-height sections, so the mobile address bar doesn't cause jumps.
- Respect safe areas with env(safe-area-inset-*) where content touches screen edges.
- No hover-only interactions. Anything that works on hover must also work on tap.
- Touch targets must be at least 44x44px.
- Animate only transform, opacity, and stroke-dashoffset. No animated blur, box-shadow, or filters, because they stutter on phones.
- Respect prefers-reduced-motion: keep the content and state changes, and drop or shorten the motion.
- Text must stay readable over any background layer at 390px width. Check contrast when a background sits behind text.
- iOS Safari support for native scroll-driven animations is incomplete. Any scroll effect must still work when Framer Motion falls back to its JS path. Verify this by testing with the native ViewTimeline unavailable.
