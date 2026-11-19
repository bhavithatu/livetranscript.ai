import { spawnSync } from 'node:child_process'

// Explicit preview build override only. Ordinary app builds never call this.
if (process.env.VERCEL_ENV !== 'preview' || !/^[a-f0-9]{40}$/.test(process.env.VERCEL_GIT_COMMIT_SHA ?? '')) {
  throw new Error('Assessment quality build requires a commit-bound Vercel preview.')
}
if (!process.env.OPENAI_API_KEY?.trim() || !process.env.ANTHROPIC_API_KEY?.trim()) {
  throw new Error('Both existing provider credentials must be configured for this preview.')
}
function run(command, args, env = process.env) {
  const child = spawnSync(command, args, { stdio: 'inherit', env, timeout: 600_000 })
  if (child.error || child.status !== 0) process.exit(1)
}
const models = 'anthropic:claude-sonnet-5-5,openai:gpt-6.2-sol'
run(process.execPath, ['scripts/build-assessment-preview.mjs'])
run('pnpm', ['exec', 'vitest', 'run', '--config', 'evals/aptitude/behavioral.config.ts'], {
  ...process.env, LT_RUN_BEHAVIORAL_CHECK: '1', BEHAVIORAL_CHECK_MODELS: models, BEHAVIORAL_CHECK_MAX_CALLS: '6',
})
run('pnpm', ['build'], {
  ...process.env, LT_RUN_APTITUDE_SELECTION_CHECK: '1', LT_APTITUDE_SELECTION_COMMIT: process.env.VERCEL_GIT_COMMIT_SHA,
  APTITUDE_SELECTION_MODELS: models, APTITUDE_SELECTION_MAX_CALLS: '24',
})
