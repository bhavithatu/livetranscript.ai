import { canonicalAptitudeOptionLabel } from '@/lib/aptitude/comparison'

/** A numeric answer is often also emitted as its label; do not render "36 — 36". */
export function formatAptitudeOption(option: { label: string; text: string }): string {
  const label = canonicalAptitudeOptionLabel(option.label)
  const text = option.text.trim()
  return !label || label === text ? text : `${label} — ${text}`
}
