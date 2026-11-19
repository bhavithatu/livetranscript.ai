import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({ plugins: [tsconfigPaths()], test: {
  environment: 'node', include: ['evals/aptitude/runReleaseCheck.ts'], testTimeout: 120_000, fileParallelism: false,
} })
