/** Match the proven Aptitude event budget so deployment logs preserve the full
 * report. Split compact JSON at Unicode code-point boundaries, never bytes. */
export const BEHAVIORAL_REPORT_LOG_MAX_BYTES = 2_000
const PREFIX = '[behavioral-consistency-eval] '

export function behavioralReportLogLines(report: unknown): string[] {
  const json = JSON.stringify(report)
  if (json === undefined) throw new Error('Behavioral evaluation report must be JSON serializable.')
  const budget = BEHAVIORAL_REPORT_LOG_MAX_BYTES - Buffer.byteLength(PREFIX) - 40
  const chunks: string[] = []
  let current = ''
  let used = 0
  for (const character of json) {
    const bytes = Buffer.byteLength(character)
    if (used + bytes > budget) { chunks.push(current); current = ''; used = 0 }
    current += character
    used += bytes
  }
  if (current) chunks.push(current)
  return chunks.map((chunk, index) => `${PREFIX}[part ${index + 1}/${chunks.length}] ${chunk}`)
}

/** Bind a deployment report only to an actual complete Git SHA, never arbitrary
 * environment text. No environment or provider credentials are included. */
export function behavioralReportSourceCommit(env: Record<string, string | undefined>): string | null {
  const sha = env.VERCEL_GIT_COMMIT_SHA
  return sha && /^[0-9a-f]{40}$/i.test(sha) ? sha.toLowerCase() : null
}
