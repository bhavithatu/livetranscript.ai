import type { AptitudeGridInventory, AptitudeQuestion } from '@/lib/aptitude/schema'
import { ROTATION_PANELS } from './visualRender'

const cellNames = (cells: readonly number[]) => cells.map(index => `r${Math.floor(index / 3) + 1}c${index % 3 + 1}`).sort()
const configurations = ROTATION_PANELS.map(cellNames)

/** Independent fixture truth; never supplied to the provider or application prompt. */
export function hasCorrectStructuredRotationGridInventory(inventory: AptitudeGridInventory, options: AptitudeQuestion['options']): boolean {
  if (inventory.rows !== 3 || inventory.columns !== 3 || inventory.cellRows !== 3 || inventory.cellColumns !== 3
    || inventory.panels.length !== 9 || inventory.options.length !== 4 || options.length !== 4) return false

  const matches = (actual: readonly string[] | null, expected: readonly string[] | null) => expected === null
    ? actual === null
    : actual !== null && actual.length === expected.length && new Set(actual).size === expected.length
      && [...actual].sort().every((cell, index) => cell === expected[index])
  const seenPanels = new Set<string>()
  for (const panel of inventory.panels) {
    if (!Number.isInteger(panel.row) || !Number.isInteger(panel.column)
      || panel.row < 1 || panel.row > 3 || panel.column < 1 || panel.column > 3) return false
    const key = `${panel.row},${panel.column}`
    if (seenPanels.has(key)) return false
    seenPanels.add(key)
    const expected = panel.row === 3 && panel.column === 3 ? null : configurations[(panel.row + panel.column - 2) % 4]
    if (!matches(panel.filledCells, expected)) return false
  }

  // Option IDs are provider-assigned; only their mapping to visible labels is
  // meaningful. Array position or the selected answer alone cannot establish it.
  const byId = new Map<string, number>()
  const labels = new Set<string>()
  for (const option of options) {
    const match = /^(?:\(\s*([a-d])\s*\)|\[\s*([a-d])\s*\]|([a-d])\.?)$/iu.exec(option.label.trim())
    const label = match ? (match[1] ?? match[2] ?? match[3]).toUpperCase() : null
    if (!label || byId.has(option.id) || labels.has(label)) return false
    labels.add(label)
    byId.set(option.id, 'ABCD'.indexOf(label))
  }
  const seenOptions = new Set<string>()
  for (const option of inventory.options) {
    const index = byId.get(option.optionId)
    if (index === undefined || seenOptions.has(option.optionId)) return false
    seenOptions.add(option.optionId)
    if (!matches(option.filledCells, configurations[(index + 1) % 4])) return false
  }
  return seenPanels.size === 9 && seenOptions.size === 4
}
