export type BehavioralAdvice = { suggestedResponse: string; assessedBehavior: string; constructiveBehavior: string }

/** Presentation-only parsing; keep legacy or malformed messages intact. */
export function parseBehavioralAdvice(message: string): BehavioralAdvice | null {
  const labels = ['Suggested response', 'What this may assess', 'Constructive behavior'] as const
  const matches = [...message.matchAll(/^(Suggested response|What this may assess|Constructive behavior):[ \t]*/gm)]
  if (matches.length !== 3 || new Set(matches.map(m => m[1])).size !== 3 || message.slice(0, matches[0].index).trim()) return null
  const parts = Object.fromEntries(matches.map((match, index) => [match[1], message.slice(match.index! + match[0].length, matches[index + 1]?.index ?? message.length).trim()]))
  if (labels.some(label => !parts[label])) return null
  return { suggestedResponse: parts[labels[0]], assessedBehavior: parts[labels[1]], constructiveBehavior: parts[labels[2]] }
}
