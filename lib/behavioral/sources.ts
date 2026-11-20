import { MAX_BEHAVIORAL_ARCHIVE_BYTES, MAX_BEHAVIORAL_SOURCE_TEXT } from './session'

export type BehavioralSource = { label: string; text: string }
export const BEHAVIORAL_SOURCES_PREFIX = 'LIVE_TRANSCRIPT_BEHAVIORAL_SOURCES_V1\n'
export const MAX_BEHAVIORAL_SOURCE_LABEL = 160
const MAX_SOURCES = 100

function validateSources(value: unknown): BehavioralSource[] {
  if (!Array.isArray(value) || value.length > MAX_SOURCES) throw new Error('Provide at most 100 original behavioral source blocks.')
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).some((key) => key !== 'label' && key !== 'text')) throw new Error('Each original source needs a label and its exact text.')
    const source = entry as Record<string, unknown>
    if (typeof source.label !== 'string' || !source.label.trim() || source.label.length > MAX_BEHAVIORAL_SOURCE_LABEL
      || /[\u0000-\u001F\u007F]/.test(source.label)) throw new Error('Original source labels must be non-empty text of at most 160 characters.')
    if (typeof source.text !== 'string' || !source.text.trim() || source.text.length > MAX_BEHAVIORAL_SOURCE_TEXT
      || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(source.text)) throw new Error('Original source text must be non-empty and at most 120,000 characters.')
    return { label: source.label, text: source.text }
  })
}
function checkSize(context: string) {
  if (new TextEncoder().encode(context).byteLength > MAX_BEHAVIORAL_ARCHIVE_BYTES) throw new Error('Original behavioral source bundle exceeds the archive limit.')
}

/** Serialize whole, labeled evidence blocks. Identical paragraphs belonging to
 * different stories retain both associations; no extraction model is involved. */
export function serializeBehavioralSources(sources: BehavioralSource[]): string {
  const context = BEHAVIORAL_SOURCES_PREFIX + JSON.stringify(validateSources(sources))
  checkSize(context)
  return context
}

/** A legacy plain-text context remains one complete source. A marked structured
 * bundle must validate; malformed marked data never falls back to unlabeled text. */
export function parseBehavioralSources(context: string): BehavioralSource[] {
  if (typeof context !== 'string') throw new Error('Original behavioral context must be text.')
  checkSize(context)
  if (!context.trim()) return []
  if (!context.startsWith(BEHAVIORAL_SOURCES_PREFIX)) return validateSources([{ label: 'Original supplied context', text: context }])
  let raw: unknown
  try { raw = JSON.parse(context.slice(BEHAVIORAL_SOURCES_PREFIX.length)) }
  catch { throw new Error('Original behavioral source bundle is malformed.') }
  return validateSources(raw)
}
