import { ROTATION_PANELS } from './visualRender'

// Headings and repeated label coordinates describe record scope, not cell
// contents. Normalize only this bounded grammar; inventory bodies stay literal.
const ROW_HEADING = /^(?:(?:source|panel|grid|matrix)\s+){0,2}row\s+(\d+)\s*:\s*/iu
const CHOICE_HEADING = /^(?:answer\s+)?(?:choices|options)(?:\s*,\s*(?:from\s+)?(?:left\s+to\s+right|top\s+to\s+bottom)|\s*\(\s*(?:from\s+)?(?:left\s+to\s+right|top\s+to\s+bottom)\s*\))?\s*:\s*/iu
const PANEL_ALIAS = /^\(\s*r\s*(\d+)\s*c\s*(\d+)\s*\)\s*:?\s*/iu
const MISSING_LOCATION = /(?:\bat\s+(?:(?:panel|position)\s+)?(?:\(\s*)?r\s*(\d+)\s*c\s*(\d+)\s*\)?|\(\s*r\s*(\d+)\s*c\s*(\d+)\s*\))\s*$/iu

type GridOption = { label: string; text: string }

function canonicalChoiceLabel(label: string): string | null {
  const match = /^(?:\(\s*([a-z])\s*\)|\[\s*([a-z])\s*\]|([a-z])\.?)$/iu.exec(label.trim())
  return match ? (match[1] ?? match[2] ?? match[3]).toUpperCase() : null
}

/** A complete literal triplet, with no omitted, duplicate, extra or out-of-grid cells. */
function cellTripletMatches(inventory: string, target: readonly number[]): boolean {
  const coordinates = [...inventory.matchAll(/\br\s*(\d+)\s*c\s*(\d+)\b/giu)]
  if (coordinates.length !== 3) return false
  const remainder = inventory.replace(/\br\s*\d+\s*c\s*\d+\b/giu, '').replace(/\band\b/giu, '')
  if (!/^[\s,()[\]{}]*$/u.test(remainder)) return false
  const cells = coordinates.map(match => [Number(match[1]), Number(match[2])])
  if (cells.some(([row, column]) => row < 1 || row > 3 || column < 1 || column > 3)) return false
  const indices = cells.map(([row, column]) => (row - 1) * 3 + column - 1).sort((a, b) => a - b)
  return new Set(indices).size === 3 && indices.join(',') === target.join(',')
}

function optionInventoryMatches(text: string, target: readonly number[], filledContext: boolean): boolean {
  // The structured option label already supplies the record identity. Its text
  // may be a literal triplet or an explicitly filled/shaded grid description.
  const description = text.trim().replace(/\.$/u, '')
    .replace(/^(?:a\s+)?(?:3\s*[x×]\s*3\s+)?(?:grid|panel)\s+/iu, '')
    .replace(/^(?:has|contains|with)\s+/iu, '')
  const filled = /^(?:filled|shaded)(?:\s+(?:cells?|squares?|positions?))?\s*(?:at\s*)?:?\s*/iu.exec(description)
  if (!filled && !filledContext) return false
  return cellTripletMatches(description.slice(filled?.[0].length ?? 0), target)
}

/** Complete coordinates establish this fixture's rotation; null leaves the verbal fallback applicable. */
export function hasCorrectRotationGridInventory(items: readonly string[], options: readonly GridOption[] = []): boolean | null {
  // Once coordinates are supplied, a correct phrase cannot mask a defective inventory.
  if (![...items, ...options.map(option => option.text)].some(item => /\br\s*\d+\s*c\s*\d+\b/i.test(item))) return null
  const expected = new Map<string, readonly number[] | null>()
  for (let row = 1; row <= 3; row++) {
    for (let column = 1; column <= 3; column++) {
      expected.set(`panel:r${row}c${column}`, row === 3 && column === 3 ? null : ROTATION_PANELS[(row + column - 2) % 4])
    }
  }
  for (const [index, label] of [...'ABCD'].entries()) expected.set(`choice:${label}`, ROTATION_PANELS[(index + 1) % 4])

  // A cross-reference is context only: it cannot establish any option's cells.
  // Coordinate-only option texts need an explicit positive filled-cell context.
  const optionReferences = items.filter(item => /\b(?:choices|options)\b/iu.test(item) && /\bquestion\.options\b/iu.test(item))
  if (optionReferences.some(item => /\b(?:empty|unfilled|blank)\s+(?:cells?|squares?|positions?)\b|\b(?:not|no)\s+(?:(?:the|all)\s+)?(?:filled|shaded)\b/iu.test(item))) return false
  const referencedFilled = optionReferences.some(item => /\b(?:filled|shaded)\s+(?:cells?|squares?|positions?)\b/iu.test(item))
  const seen = new Set<string>()
  for (const item of items) {
    let rowScope: string | null = null
    let filledRow: string | null = null
    let panelsFilled = false
    let choicesFilled = false
    for (let clause of item.split(/[;.\n]/u).map(value => value.trim()).filter(Boolean)) {
      const rowHeading = ROW_HEADING.exec(clause)
      if (rowHeading) { rowScope = rowHeading[1]; filledRow = rowScope; panelsFilled = false; choicesFilled = false; clause = clause.slice(rowHeading[0].length) }
      const choiceHeading = CHOICE_HEADING.exec(clause)
      if (choiceHeading) { choicesFilled = false; panelsFilled = false; filledRow = null; rowScope = null; clause = clause.slice(choiceHeading[0].length) }
      const explicit = /^(?:panel\s+)?r\s*(\d+)\s*c\s*(\d+)\b\s*:?\s*/iu.exec(clause)
      const scoped = /^panel\s+(?:c\s*)?(\d+)\b\s*:?\s*/iu.exec(clause)
      const choice = /^(?:(?:choice|option)\s+)?([A-Z])\b\s*:?\s*/iu.exec(clause)
      const label = explicit ?? scoped ?? choice
      if (!label) continue
      const key = explicit ? `panel:r${explicit[1]}c${explicit[2]}`
        : scoped ? `panel:r${rowScope}c${scoped[1]}` : `choice:${choice![1].toUpperCase()}`
      if (explicit && rowScope !== null && explicit[1] !== rowScope) return false
      if (!expected.has(key) || seen.has(key)) return false
      seen.add(key)
      let body = clause.slice(label[0].length).trim()
      const target = expected.get(key)
      const isChoice = !explicit && !scoped
      const alias = !isChoice ? PANEL_ALIAS.exec(body) : null
      if (alias) {
        if (key !== `panel:r${alias[1]}c${alias[2]}`) return false
        body = body.slice(alias[0].length)
      }
      if (!isChoice) {
        choicesFilled = false
        const sourceRow = explicit?.[1] ?? rowScope
        if (sourceRow !== filledRow) { filledRow = sourceRow; panelsFilled = false }
      } else { panelsFilled = false; filledRow = null }
      if (target === null) {
        const location = MISSING_LOCATION.exec(body)
        if (location) {
          if (key !== `panel:r${location[1] ?? location[3]}c${location[2] ?? location[4]}`) return false
          body = body.slice(0, location.index).trim()
        }
        if (!/\?|question\s+mark|\bmissing\s+panel\b/iu.test(body) || /\br\s*\d+\s*c\s*\d+\b|\bfilled\b/iu.test(body)) return false
        continue
      }
      const description = body.replace(/^(?:has|contains|with)\s+/iu, '')
      const filled = /^filled(?:\s+(?:cells?|squares?|positions?))?\s*(?:at\s*)?:?\s*/iu.exec(description)
      // A row or choice list may state “has filled cells” once and then abbreviate.
      // Qualifiers never carry across rows, source/choice contexts, or evidence items.
      if (!filled && !(isChoice ? choicesFilled : panelsFilled)) return false
      if (filled) { if (isChoice) choicesFilled = true; else panelsFilled = true }
      const inventory = description.slice(filled?.[0].length ?? 0)
      // Nothing beyond a literal triplet is silently treated as another cell or ignored.
      if (!cellTripletMatches(inventory, target!)) return false
    }
  }

  // Evidence and parsed options may repeat the same true facts. They are
  // validated independently, so either source can complete an omitted choice
  // inventory, but a correct source cannot override a contradictory one.
  if (options.length) {
    if (options.length !== 4) return false
    const optionLabels = new Set<string>()
    for (const option of options) {
      const label = canonicalChoiceLabel(option.label)
      const key = `choice:${label}`
      if (!label || !expected.has(key) || optionLabels.has(label)) return false
      optionLabels.add(label)
      if (!/\br\s*\d+\s*c\s*\d+\b/iu.test(option.text)) continue
      if (!optionInventoryMatches(option.text, expected.get(key)!, referencedFilled || seen.has(key))) return false
      seen.add(key)
    }
  }
  return seen.size === expected.size
}
