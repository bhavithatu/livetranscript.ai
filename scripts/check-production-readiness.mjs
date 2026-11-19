import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { aptitudeReleaseEnvironment } from './aptitude-release-environment.mjs'
const enabled = process.env.VERCEL_ENV === 'production' || process.env.LT_RUN_LIVE_ACCEPTANCE === '1'
const aptitudeEnvironment = aptitudeReleaseEnvironment(process.env)
mkdirSync('public', { recursive: true })
writeFileSync('public/aptitude-readiness.json', JSON.stringify({ passed: false, complete: false, scope: 'not-run', environment: process.env.VERCEL_ENV === 'preview' ? 'preview' : aptitudeEnvironment ?? 'local-or-ci', liveModel: false, deviceVerified: false }))
if (!enabled) {
  mkdirSync('public', { recursive: true })
  writeFileSync('public/release-readiness.json', JSON.stringify({ passed: false, scope: 'not-run', deviceVerified: false }))
  console.log('[readiness] Paid live acceptance was NOT run for this local/preview build.')
} else {
  console.log('[readiness] Running bounded synthetic model, vision and ASR recovery checks; failures block this build.')
  const child = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['exec', 'vitest', 'run', '--config', 'evals/reliability/vitest.config.ts'], { stdio: 'inherit', env: process.env, timeout: 190_000 })
  if (child.error || child.status !== 0) process.exit(1)
}
if (aptitudeEnvironment) {
  console.log(`[readiness] Running four original Aptitude diagrams for ${aptitudeEnvironment} against all two or three configured comparison models, capped at twelve provider calls; failures block this build.`)
  const child = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['exec', 'vitest', 'run', '--config', 'evals/aptitude/release.config.ts'], { stdio: 'inherit', env: process.env, timeout: 130_000 })
  if (child.error || child.status !== 0) process.exit(1)
} else {
  console.log('[readiness] Aptitude live release checks were NOT run: production or an explicitly opted-in Vercel preview is required.')
}
