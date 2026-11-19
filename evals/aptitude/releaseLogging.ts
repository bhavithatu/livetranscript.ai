/** Vercel truncates large console events. Keep every release diagnostic below 2,000 bytes. */
export const APTITUDE_RELEASE_LOG_MAX_BYTES = 2_000

export function aptitudeReleaseLogLines(
  section: 'fixture' | 'candidate' | 'score' | 'evidence' | 'explanation' | 'option' | 'summary',
  context: { fixtureId?: string; modelId?: string; item?: number },
  details: Record<string, unknown>,
): string[] {
  const prefix = `[aptitude-release-${section}] ${JSON.stringify(context)} `
  // Reserve room for part numbers; the original JSON text is split without re-escaping it.
  const budget = APTITUDE_RELEASE_LOG_MAX_BYTES - Buffer.byteLength(prefix) - 40
  if (budget < 4) throw new Error('Release log context exceeds the event budget')
  const chunks: string[] = []
  let current = '', used = 0
  for (const character of JSON.stringify(details)) {
    const bytes = Buffer.byteLength(character)
    if (used + bytes > budget) { chunks.push(current); current = ''; used = 0 }
    current += character; used += bytes
  }
  if (current) chunks.push(current)
  return chunks.map((chunk, index) => `${prefix}[part ${index + 1}/${chunks.length}] ${chunk}`)
}
