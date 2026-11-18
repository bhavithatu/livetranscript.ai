import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({ plugins: [tsconfigPaths()], test: { environment: 'node', include: ['evals/aptitude/*.test.ts', 'evals/aptitude/prepareFixtures.ts', 'evals/aptitude/runBenchmark.ts'], testTimeout: 30_000 } })
