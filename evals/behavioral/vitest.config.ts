import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

// Live calls are doubly opt-in: this dedicated config plus BEHAVIORAL_EVAL_RUN=1.
// Ordinary npm test only runs the offline *.test.ts contract cases.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: { environment: 'node', include: ['evals/behavioral/*.test.ts', 'evals/behavioral/runConsistency.ts'], testTimeout: 240_000 },
})
