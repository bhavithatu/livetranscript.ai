import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({ plugins: [tsconfigPaths()], test: {
  environment: 'node', include: ['evals/aptitude/runSelectionCheck.ts'], testTimeout: 340_000, fileParallelism: false,
} })
