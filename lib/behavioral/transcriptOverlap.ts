// Exact text matching only. A short accidental match is not enough to establish
// that two independently changed transcript windows share the same utterance.
export const MIN_TRANSCRIPT_OVERLAP_CHARS = 24

export function exactSuffixPrefixOverlap(previous: string, next: string): number {
  if (!previous || !next) return 0
  // NUL never occurs in validated transcript/source records.
  const search = `${next}\u0000${previous.slice(-next.length)}`
  const prefix = new Uint32Array(search.length)
  for (let index = 1; index < search.length; index++) {
    let matched = prefix[index - 1]
    while (matched && search[index] !== search[matched]) matched = prefix[matched - 1]
    if (search[index] === search[matched]) matched++
    prefix[index] = matched
  }
  return Math.min(next.length, prefix[search.length - 1])
}
