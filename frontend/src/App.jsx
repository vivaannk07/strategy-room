import { lazy, Suspense } from 'react'
import LandingPage from './pages/LandingPage'

// `?mock=true` swaps in the pre-API landing flow, fed entirely by src/lib/mockRaceData.js
// with no network calls, for offline dev and demos. Loaded lazily so the mock tree stays
// out of the default bundle.
const MockLandingPage = lazy(() => import('./pages/MockLandingPage'))

const isMockMode = new URLSearchParams(window.location.search).get('mock') === 'true'

export default function App() {
  if (!isMockMode) return <LandingPage />

  return (
    <Suspense fallback={<main className="min-h-screen bg-neutral-950" />}>
      <MockLandingPage />
    </Suspense>
  )
}
