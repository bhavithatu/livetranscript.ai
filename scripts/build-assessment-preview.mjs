import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

// Resolve the already locked Vite dependency used by Vitest, without installing
// a second runtime. This opt-in build adds original examples to the preview.
const require = createRequire(import.meta.url)
const fromVitest = createRequire(require.resolve('vitest/package.json'))
const vite = resolve(dirname(fromVitest.resolve('vite/package.json')), 'bin/vite.js')
const child = spawnSync(process.execPath, [vite, 'build', '--config', 'qa/aptitude/clean-preview/vite.config.ts',
  '--base', '/assessment-preview/', '--outDir', resolve('public/assessment-preview')], { stdio: 'inherit' })
if (child.error || child.status !== 0) process.exit(1)
