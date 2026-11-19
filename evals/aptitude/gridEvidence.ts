import { ROTATION_PANELS } from './visualRender'

/** Complete coordinates establish this fixture's rotation; null leaves the verbal fallback applicable. */
export function hasCorrectRotationGridInventory(items: readonly string[]): boolean | null {
  // Once coordinates are supplied, a correct phrase cannot mask a defective inventory.
  if (!items.some(item => /\br\s*\d+\s*c\s*\d+\b/i.test(item))) return null
  const expected = new Map<string, readonly number[] | null>()
  for (let row = 1; row <= 3; row++) {
    for (let column = 1; column <= 3; column++) {
      expected.set(`panel:r${row}c${column}`, row === 3 && column === 3 ? null : ROTATION_PANELS[(row + column - 2) % 4])
    }
  }
  for (const [index, label] of [...'ABCD'].entries()) expected.set(`choice:${label}`, ROTATION_PANELS[(index + 1) % 4])

  const seen = new Set<string>()
  for (const item of items) {
    let rowScope: string | null = null
    let filledRow: string | null = null
    let panelsFilled = false
    let choicesFilled = false
    for (let clause of item.split(/[;.\n]/u).map(value => value.trim()).filter(Boolean)) {
      const rowHeading = /^(?:panel\s+)?row\s+(\d+)\s*:\s*/iu.exec(clause)
      if (rowHeading) { rowScope = rowHeading[1]; filledRow = rowScope; panelsFilled = false; choicesFilled = false; clause = clause.slice(rowHeading[0].length) }
      if (/^(?:choices|options)\s*:/iu.test(clause)) { choicesFilled = false; panelsFilled = false; filledRow = null }
      clause = clause.replace(/^(?:choices|options)\s*:\s*/iu, '')
      const explicit = /^(?:panel\s+)?r\s*(\d+)\s*c\s*(\d+)\b\s*:?\s*/iu.exec(clause)
      const scoped = /^panel\s+(?:c\s*)?(\d+)\b\s*:?\s*/iu.exec(clause)
      const choice = /^(?:(?:choice|option)\s+)?([A-Z])\b\s*:?\s*/iu.exec(clause)
      const label = explicit ?? scoped ?? choice
      if (!label) continue
      const key = explicit ? `panel:r${explicit[1]}c${explicit[2]}`
        : scoped ? `panel:r${rowScope}c${scoped[1]}` : `choice:${choice![1].toUpperCase()}`
      if (!expected.has(key) || seen.has(key)) return false
      seen.add(key)
      const body = clause.slice(label[0].length).trim()
      const target = expected.get(key)
      const isChoice = !explicit && !scoped
      if (!isChoice) {
        choicesFilled = false
        const sourceRow = explicit?.[1] ?? rowScope
        if (sourceRow !== filledRow) { filledRow = sourceRow; panelsFilled = false }
      } else { panelsFilled = false; filledRow = null }
      if (target === null) {
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
      const coordinates = [...inventory.matchAll(/\br\s*(\d+)\s*c\s*(\d+)\b/giu)]
      if (coordinates.length !== 3) return false
      // Nothing beyond a literal triplet is silently treated as another cell or ignored.
      const remainder = inventory.replace(/\br\s*\d+\s*c\s*\d+\b/giu, '').replace(/\band\b/giu, '')
      if (!/^[\s,()[\]{}]*$/u.test(remainder)) return false
      const cells = coordinates.map(match => [Number(match[1]), Number(match[2])])
      if (cells.some(([row, column]) => row < 1 || row > 3 || column < 1 || column > 3)) return false
      const indices = cells.map(([row, column]) => (row - 1) * 3 + column - 1).sort((a, b) => a - b)
      if (new Set(indices).size !== 3 || indices.join(',') !== target!.join(',')) return false
    }
  }
  return seen.size === expected.size
}
