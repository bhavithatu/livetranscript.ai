/**
 * Production is always gated. Preview requires an explicit deployment opt-in;
 * the flag alone never enables paid calls in local or ordinary CI runs.
 * @param {Record<string, string | undefined>} env
 * @returns {'production' | 'preview' | null}
 */
export function aptitudeReleaseEnvironment(env) {
  if (env.VERCEL_ENV === 'production') return 'production'
  if (env.VERCEL_ENV === 'preview' && env.LT_RUN_APTITUDE_RELEASE_CHECK === '1') return 'preview'
  return null
}
