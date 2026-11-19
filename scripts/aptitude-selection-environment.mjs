/** Selection is an explicit, commit-bound deployment experiment; ordinary builds never call providers. */
export function aptitudeSelectionEnvironment(env) {
  if (env.LT_RUN_APTITUDE_SELECTION_CHECK !== '1') return null
  if (env.VERCEL_ENV !== 'preview' && env.VERCEL_ENV !== 'production') return null
  if (!/^[a-f0-9]{40}$/.test(env.LT_APTITUDE_SELECTION_COMMIT ?? '') || env.LT_APTITUDE_SELECTION_COMMIT !== env.VERCEL_GIT_COMMIT_SHA) {
    throw new Error('Aptitude selection requires LT_APTITUDE_SELECTION_COMMIT to match this deployment commit exactly.')
  }
  return env.VERCEL_ENV
}
