import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({ plugins: [tsconfigPaths()], test: {
  environment: 'node', include: ['evals/aptitude/prepareSelectionFixtures.ts'], testTimeout: 30_000,
} })
