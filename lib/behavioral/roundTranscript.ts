import { MAX_BEHAVIORAL_SOURCE_TEXT } from './session'
import { exactSuffixPrefixOverlap, MIN_TRANSCRIPT_OVERLAP_CHARS } from './transcriptOverlap'

export type BehavioralTranscriptBoundary = {
  reset: (baseline: string) => void
  read: (current: string) => { text: string; uncertain: boolean }
}

/** A reset separates future source speech from the prior interview even when
 * ASR retains or rotates its old window. Only an exact continuation is kept.
 * Changed utterances are not guessed to be new speech or user corrections. */
export function createBehavioralTranscriptBoundary(): BehavioralTranscriptBoundary {
  let active = false
  let previous = ''
  let accumulated = ''
  let uncertain = false
  return {
    reset(baseline) {
      active = true
      previous = baseline
      accumulated = ''
      uncertain = false
    },
    read(current) {
      if (!active) return { text: current, uncertain: false }
      if (current === previous) return { text: accumulated, uncertain }
      let suffix = ''
      let missed = false
      if (!previous) {
        // An explicitly empty baseline establishes a fresh source stream.
        suffix = current
      } else if (current.startsWith(previous)) {
        suffix = current.slice(previous.length)
      } else if (previous.includes(current)) {
        // A shortened window containing only already-observed speech adds no
        // new evidence; retain the complete prior comparison boundary so an
        // older suffix cannot be presented as new on the following read.
        return { text: accumulated, uncertain }
      } else {
        const overlap = exactSuffixPrefixOverlap(previous, current)
        if (overlap >= MIN_TRANSCRIPT_OVERLAP_CHARS) suffix = current.slice(overlap)
        else missed = true
      }
      if (accumulated.length + suffix.length > MAX_BEHAVIORAL_SOURCE_TEXT) {
        throw new Error('New-round transcript exceeds 120,000 characters. Export this round and start another; no transcript text has been silently truncated.')
      }
      previous = current
      accumulated += suffix
      uncertain ||= missed
      return { text: accumulated, uncertain }
    },
  }
}
