import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import type { AptitudeFixture } from './fixtures'

export type SelectionDiagram = 'relative_bars' | 'ordered_transform' | 'exclusive_or' | 'shape_values' | 'cropped_turn'
export type SelectionGridTruth = {
  rows: number; columns: number; cellRows: number; cellColumns: number
  panels: { row: number; column: number; filledCells: string[] | null }[]
  options: Record<string, string[]>
}
export type SelectionFixture = {
  id: string
  domain: string
  lines: string[]
  choices: { label: string; text: string }[]
  diagram?: SelectionDiagram
  cropped?: boolean
  expected: AptitudeFixture['expected']
  gridTruth?: SelectionGridTruth
}

const choices = (values: string[]) => values.map((text, index) => ({ label: 'ABCD'[index], text }))
const coord = (cells: readonly number[]) => cells.map(cell => `r${Math.floor(cell / 3) + 1}c${cell % 3 + 1}`)

/** Independently authored before candidate calls. Answers and metadata never enter a model request. */
export const SELECTION_XOR_PANELS = [
  [0, 4, 7], [1, 4, 8], [0, 1, 7, 8],
  [1, 3, 6], [1, 5, 6], [3, 5],
  [2, 4, 6], [0, 4, 8], [0, 2, 6, 8],
] as const
export const SELECTION_XOR_OPTIONS = [[0, 2, 4, 6], [0, 2, 6, 8], [2, 4, 6, 8], [0, 4, 6, 8]] as const
export const SELECTION_TRANSFORM_SOURCE = [0, 1, 5, 7] as const
export const SELECTION_TRANSFORM_OPTIONS = [[1, 2, 3, 7], [2, 3, 5, 7], [0, 3, 5, 7], [1, 3, 5, 8]] as const

export const APTITUDE_SELECTION_FIXTURES: readonly SelectionFixture[] = [
  {
    id: 'selection-reverse-discount', domain: 'numerical:inverse-percentage',
    lines: ['A jacket costs 96 dollars after a 20% discount.', 'What was its price before the discount? Choose one.'],
    choices: choices(['115.20 dollars', '116 dollars', '120 dollars', '125 dollars']),
    expected: { category: 'numerical', status: 'solved', selectedLabels: ['C'], criticalText: ['96', '20%'], calculationValue: 120 },
  },
  {
    id: 'selection-weighted-price', domain: 'numerical:weighted-average',
    lines: ['A shop sells 120 units at 15 dollars each and', '80 units at 21 dollars each.', 'What is the average price per unit across all 200 units?'],
    choices: choices(['18 dollars', '18.60 dollars', '19 dollars', '17.40 dollars']),
    expected: { category: 'numerical', status: 'solved', selectedLabels: ['D'], criticalText: ['120', '15', '80', '21', '200'], calculationValue: 17.4 },
  },
  {
    id: 'selection-relative-chart', domain: 'data:relative-versus-absolute',
    lines: ['Sales are shown in thousands of units.', 'Which store had the largest PERCENTAGE increase?'],
    choices: choices(['Birch', 'Aspen', 'Cedar', 'All three had the same increase']), diagram: 'relative_bars',
    expected: { category: 'data_interpretation', status: 'solved', selectedLabels: ['B'], criticalText: ['PERCENTAGE', 'Aspen', 'Birch', 'Cedar'] },
  },
  {
    id: 'selection-passage-scope', domain: 'verbal:entailment-and-scope',
    lines: ['PASSAGE: Every overnight parcel has a tracking code.', 'Some tracked parcels are sent by standard delivery.', 'Standard and overnight are mutually exclusive services.', 'CLAIM: Every parcel with a tracking code is overnight.', 'Using only the passage, evaluate the claim.'],
    choices: choices(['True', 'False', 'Cannot say']),
    expected: { category: 'verbal', status: 'solved', selectedLabels: ['B'], criticalText: ['Every overnight', 'Some tracked', 'standard'] },
  },
  {
    id: 'selection-necessary-assumption', domain: 'critical:necessary-assumption',
    lines: ['A planner argues: installing a second water pump will', 'double the volume delivered each hour because both pumps', 'can run at the same rate as the current pump.', 'Which assumption is necessary for this argument?'],
    choices: choices(['The pumps are painted the same colour.', 'Water demand will double next year.', 'Both pumps were made by the same company.', 'The shared supply and pipes can sustain the combined flow.']),
    expected: { category: 'critical_reasoning', status: 'solved', selectedLabels: ['D'], criticalText: ['double', 'same rate', 'necessary', 'combined flow'] },
  },
  {
    id: 'selection-five-order', domain: 'logical:ordering-constraints',
    lines: ['Ada, Ben, Cara, Dev and Eli stand in one line.', 'Ben is immediately after Dev. Ada is before Dev.', 'Cara is after Ben. Eli is last.', 'Who must be in the middle position? Choose one.'],
    choices: choices(['Ben', 'Dev', 'Cara', 'Ada']),
    expected: { category: 'logical', status: 'solved', selectedLabels: ['A'], criticalText: ['immediately', 'before', 'after', 'last'] },
  },
  {
    id: 'selection-quantifier-multiselect', domain: 'logical:quantifiers-multiple-select',
    lines: ['Every wug is blue. No blue object is hollow.', 'Some wugs are triangular.', 'Select ALL conclusions that necessarily follow.'],
    choices: choices(['Some triangular objects are blue.', 'Some hollow objects are wugs.', 'No wug is hollow.', 'Every triangular object is a wug.']),
    expected: { category: 'logical', status: 'solved', selectedLabels: ['A', 'C'], criticalText: ['Every', 'No blue', 'Some', 'ALL'] },
  },
  {
    id: 'selection-ordered-transform', domain: 'spatial:reflection-then-rotation',
    lines: ['Reflect the source left to right, THEN rotate the result', '90 degrees clockwise. Which option is the final pattern?'],
    choices: choices(['Diagram A', 'Diagram B', 'Diagram C', 'Diagram D']), diagram: 'ordered_transform',
    expected: { category: 'spatial', status: 'solved', selectedLabels: ['D'], criticalText: ['Reflect', 'THEN', '90', 'clockwise'] },
  },
  {
    id: 'selection-grid-combination', domain: 'abstract:overlap-removal',
    lines: ['The same combination rule applies across each row.', 'Use the first two panels to find the missing third panel.'],
    choices: choices(['Diagram A', 'Diagram B', 'Diagram C', 'Diagram D']), diagram: 'exclusive_or',
    expected: { category: 'abstract', status: 'solved', selectedLabels: ['B'], criticalText: ['same combination', 'each row'], requireGridInventory: true },
    gridTruth: {
      rows: 3, columns: 3, cellRows: 3, cellColumns: 3,
      panels: SELECTION_XOR_PANELS.map((cells, index) => ({ row: Math.floor(index / 3) + 1, column: index % 3 + 1, filledCells: index === 8 ? null : coord(cells) })),
      options: Object.fromEntries(SELECTION_XOR_OPTIONS.map((cells, index) => ['ABCD'[index], coord(cells)])),
    },
  },
  {
    id: 'selection-count-shape-values', domain: 'visual:counting-and-two-equations',
    lines: ['Each circle has one fixed value; each square has another.', "A panel's total is the sum of the values of its shapes.", 'What is the final total? Choose one.'],
    choices: choices(['20', '21', '22', '23']), diagram: 'shape_values',
    expected: { category: 'numerical', status: 'solved', selectedLabels: ['C'], criticalText: ['circle', 'square', 'sum'], calculationValue: 22 },
  },
  {
    id: 'selection-two-valid-rules', domain: 'boundary:explicit-ambiguity',
    lines: ['The starting number is 7. Choose EITHER operation:', 'subtract 3 OR divide by 7. Both operations are permitted.', 'All rules are shown; there is no additional tie-breaker.', 'Which SINGLE next value is uniquely determined?'],
    choices: choices(['4', '1']),
    expected: { category: 'logical', status: 'ambiguous', selectedLabels: [], criticalText: ['EITHER', 'subtract 3', 'divide by 7', 'uniquely'] },
  },
  {
    id: 'selection-cropped-turn-choices', domain: 'boundary:cropped-spatial-options',
    lines: ['Rotate the source 90 degrees counterclockwise.', 'Choose the option showing the resulting pattern.'],
    choices: choices(['Diagram A', 'Diagram B', 'Diagram C', 'Diagram D']), diagram: 'cropped_turn', cropped: true,
    expected: { category: 'spatial', status: 'needs_capture', selectedLabels: [], criticalText: ['counterclockwise'] },
  },
] as const

export function selectionScoringFixture(fixture: SelectionFixture): AptitudeFixture {
  // Choice labels are explicit on every fixture. Harmless wording/decimal formatting
  // does not turn a correct selected choice into a wrong answer in this benchmark.
  return { id: fixture.id, split: 'held_out', view: { lines: fixture.lines }, expected: fixture.expected }
}

const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const text = (value: string, x: number, y: number, size = 24, anchor = 'start') => `<text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}">${xml(value)}</text>`
function grid(cells: readonly number[], x: number, y: number, size = 78): string {
  return Array.from({ length: 9 }, (_, index) => `<rect x="${x + index % 3 * size / 3}" y="${y + Math.floor(index / 3) * size / 3}" width="${size / 3}" height="${size / 3}" fill="${cells.includes(index) ? '#075e54' : '#fff'}" stroke="#334155" stroke-width="1.5"/>`).join('')
}
function diagramSvg(kind: SelectionDiagram): string {
  if (kind === 'relative_bars') {
    const stores = [{ name: 'Aspen', before: 18, after: 24 }, { name: 'Birch', before: 40, after: 48 }, { name: 'Cedar', before: 25, after: 30 }]
    const y = 462, scale = 4.3
    return `${text('Previous year', 70, 220, 20)}<rect x="250" y="203" width="24" height="22" fill="#1d4ed8"/>${text('Current year', 320, 220, 20)}<rect x="490" y="203" width="24" height="22" fill="#b45309"/>` +
      [0, 10, 20, 30, 40, 50].map(value => `<path d="M100 ${y - value * scale}H980" stroke="#cbd5e1"/>${text(String(value), 82, y - value * scale + 7, 18, 'end')}`).join('') +
      stores.map((store, index) => { const x = 230 + index * 290; return `<rect x="${x - 65}" y="${y - store.before * scale}" width="58" height="${store.before * scale}" fill="#1d4ed8"/><rect x="${x + 7}" y="${y - store.after * scale}" width="58" height="${store.after * scale}" fill="#b45309"/>${text(String(store.before), x - 36, y - store.before * scale - 9, 21, 'middle')}${text(String(store.after), x + 36, y - store.after * scale - 9, 21, 'middle')}${text(store.name, x, 493, 23, 'middle')}` }).join('')
  }
  if (kind === 'ordered_transform') {
    return `${text('SOURCE', 130, 270, 22, 'middle')}${grid(SELECTION_TRANSFORM_SOURCE, 82, 296, 96)}` +
      SELECTION_TRANSFORM_OPTIONS.map((cells, index) => `${text('ABCD'[index], 360 + index * 180, 270, 24, 'middle')}${grid(cells, 312 + index * 180, 296, 96)}`).join('')
  }
  if (kind === 'exclusive_or') {
    return SELECTION_XOR_PANELS.slice(0, 8).map((cells, index) => grid(cells, 395 + index % 3 * 96, 210 + Math.floor(index / 3) * 96)).join('') +
      `<rect x="587" y="402" width="78" height="78" fill="#ecfdf5" stroke="#334155"/>${text('?', 626, 457, 46, 'middle')}` +
      SELECTION_XOR_OPTIONS.map((cells, index) => `${text('ABCD'[index], 260 + index * 185, 526, 23, 'middle')}${grid(cells, 221 + index * 185, 540)}`).join('')
  }
  if (kind === 'shape_values') {
    const groups = [['circle', 'square', 'square'], ['circle', 'circle', 'square'], ['circle', 'circle', 'circle', 'square', 'square']]
    return groups.map((shapes, index) => {
      const x = 130 + index * 315
      return `<rect x="${x - 42}" y="248" width="242" height="218" rx="10" fill="#fff" stroke="#64748b"/>` + shapes.map((shape, offset) => {
        const cx = x + offset % 3 * 76, cy = 302 + Math.floor(offset / 3) * 72
        return shape === 'circle' ? `<circle cx="${cx}" cy="${cy}" r="24" fill="#075e54"/>` : `<rect x="${cx - 24}" y="${cy - 24}" width="48" height="48" fill="#075e54"/>`
      }).join('') + text(['14', '13', '?'][index], x + 78, 443, 32, 'middle')
    }).join('')
  }
  return `${text('SOURCE', 540, 242, 24, 'middle')}${grid([0, 2, 3, 4], 480, 270, 120)}` +
    [[0, 3, 4, 8], [1, 2, 4, 7], [0, 1, 4, 6], [2, 3, 4, 6]].map((cells, index) => `${text('ABCD'[index], 260 + index * 185, 490, 23, 'middle')}${grid(cells, 221 + index * 185, 525)}`).join('')
}

export function selectionFixtureSvg(fixture: SelectionFixture): string {
  const height = fixture.cropped ? 510 : 680
  const lines = fixture.lines.map((line, index) => text(line, 48, 112 + index * 36, 23)).join('')
  const diagram = fixture.diagram ? diagramSvg(fixture.diagram) : ''
  const diagramHasChoices = fixture.diagram === 'ordered_transform' || fixture.diagram === 'exclusive_or' || fixture.diagram === 'cropped_turn'
  const optionsY = fixture.diagram ? 550 : 146 + fixture.lines.length * 36
  const options = diagramHasChoices ? '' : fixture.choices.map((option, index) => text(`${option.label}. ${option.text}`, 66, optionsY + index * 29, 22)).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="${height}" viewBox="0 0 1080 ${height}"><rect width="1080" height="${height}" fill="#f8fafc"/><rect width="1080" height="62" fill="#e2e8f0"/><g font-family="DejaVu Sans Mono, monospace" fill="#0f172a">${text('APTITUDE PRACTICE', 48, 40, 20)}${lines}${diagram}${options}</g></svg>`
}

export async function renderSelectionFixture(fixture: SelectionFixture): Promise<{ png: Buffer; sha256: string }> {
  const require = createRequire(import.meta.url)
  const fromNext = createRequire(require.resolve('next/package.json'))
  const sharp = fromNext('sharp') as (input: Buffer) => { png(): { toBuffer(): Promise<Buffer> } }
  const png = await sharp(Buffer.from(selectionFixtureSvg(fixture))).png().toBuffer()
  return { png, sha256: createHash('sha256').update(png).digest('hex') }
}

export const APTITUDE_SELECTION_FIXTURE_HASH = createHash('sha256').update(JSON.stringify(APTITUDE_SELECTION_FIXTURES)).digest('hex')
