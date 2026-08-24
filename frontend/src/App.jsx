import { motion } from 'framer-motion'

export default function App() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-100">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="rounded-xl border border-red-500/40 bg-neutral-900 px-8 py-6 shadow-lg"
      >
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-red-500">
          Strategy Room
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Tailwind is working</h1>
      </motion.div>
    </main>
  )
}
