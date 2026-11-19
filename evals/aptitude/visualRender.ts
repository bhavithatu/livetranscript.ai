import type { AptitudeFixture } from './fixtures'

const points = (count: number, cx: number, cy: number, outer: number, inner: number) => Array.from({ length: count * 2 }, (_, index) => {
  const angle = -Math.PI / 2 + index * Math.PI / count
  const radius = index % 2 ? inner : outer
  return `${(cx + Math.cos(angle) * radius).toFixed(2)},${(cy + Math.sin(angle) * radius).toFixed(2)}`
}).join(' ')
const star = (count: number, cx: number, cy: number, outer = 66, inner = 28) => `<polygon points="${points(count, cx, cy, outer, inner)}" fill="#087f69" stroke="#075647" stroke-width="2"/>`
const text = (value: string, x: number, y: number, size = 28) => `<text x="${x}" y="${y}" font-size="${size}" text-anchor="middle">${value}</text>`
const numericChoices = (values: string[]) => values.map((value, index) => {
  const x = 245 + index * 195
  return `<rect x="${x - 72}" y="526" width="144" height="68" rx="8" fill="#fff" stroke="#64748b"/>${text(`${'ABCD'[index]}. ${value}`, x, 568)}`
}).join('')

/** Filled cells use row-major, zero-based indices. Cell edges stay visible at native size. */
export function fixtureGrid(cells: readonly number[], x: number, y: number, size = 72): string {
  const cell = size / 3
  return `<g>${Array.from({ length: 9 }, (_, index) => `<rect x="${x + index % 3 * cell}" y="${y + Math.floor(index / 3) * cell}" width="${cell}" height="${cell}" fill="${cells.includes(index) ? '#087f69' : '#fff'}" stroke="#64748b" stroke-width="1.5"/>`).join('')}</g>`
}

const clockwise = (cells: readonly number[]) => cells.map(cell => cell % 3 * 3 + 2 - Math.floor(cell / 3)).sort((a, b) => a - b)
export const ROTATION_PANELS: readonly (readonly number[])[] = (() => {
  const panels = [[0, 3, 4]]
  for (let index = 1; index < 4; index++) panels.push(clockwise(panels[index - 1]))
  return panels
})()
export const XOR_PANELS: readonly (readonly number[])[] = [
  [0, 1, 3], [1, 4, 5], [0, 3, 4, 5],
  [2, 5, 8], [2, 4, 6], [4, 5, 6, 8],
  [0, 4, 8], [1, 4, 7], [0, 1, 7, 8],
]

function matrix(panels: readonly (readonly number[])[], choices: readonly (readonly number[])[]): string {
  const source = panels.slice(0, 8).map((cells, index) => fixtureGrid(cells, 411 + index % 3 * 88, 228 + Math.floor(index / 3) * 88)).join('')
  const missing = `<rect x="587" y="404" width="72" height="72" fill="#ecfdf5" stroke="#64748b"/>${text('?', 623, 455, 44)}`
  const options = choices.map((cells, index) => `${text('ABCD'[index], 295 + index * 160, 516, 22)}${fixtureGrid(cells, 259 + index * 160, 530)}`).join('')
  return `${source}${missing}${options}`
}

export function aptitudeVisualDiagram(fixture: AptitudeFixture): string {
  if (fixture.view.diagram === 'star_points') {
    return [4, 5, 7].map((count, index) => `${star(count, 235 + index * 305, 300)}${text(['28', '35', '?'][index], 235 + index * 305, 414, 38)}`).join('') + numericChoices(['42', '45', '49', '56'])
  }
  if (fixture.view.diagram === 'star_increments') {
    const values = ['8', '12', '18', '26', '?']
    const valueLabels = values.map((value, index) => {
      const angle = -Math.PI / 2 + index * 2 * Math.PI / 5
      const x = 540 + Math.cos(angle) * 145
      const y = 347 + Math.sin(angle) * 145 + 10
      if (fixture.view.layout === 'obscured_diagram' && index < 4) {
        // Remove the critical information instead of assuming a blur is unreadable to every model.
        return `<rect x="${x - 26}" y="${y - 27}" width="52" height="35" rx="2" fill="#b8bdc5"/>`
      }
      return text(value, x, y, 31)
    }).join('')
    return `${star(5, 540, 347, 106, 45)}${valueLabels}${numericChoices(['34', '36', '38', '32'])}`
  }
  if (fixture.view.diagram === 'grid_rotation') {
    const panels = Array.from({ length: 9 }, (_, index) => ROTATION_PANELS[(Math.floor(index / 3) + index % 3) % 4])
    return matrix(panels, [ROTATION_PANELS[1], ROTATION_PANELS[2], ROTATION_PANELS[3], ROTATION_PANELS[0]])
  }
  if (fixture.view.diagram === 'grid_xor') return matrix(XOR_PANELS, [XOR_PANELS[8], [0, 1, 4, 7, 8], [4], [0, 8]])
  if (fixture.view.diagram === 'spatial_ambiguous') {
    return `${text('SOURCE', 260, 300, 24)}${fixtureGrid([0, 1, 3], 212, 324, 96)}${[
      [1, 2, 5], [5, 7, 8], [0, 1, 3],
    ].map((cells, index) => `${text('ABC'[index], 540 + index * 165, 300, 24)}${fixtureGrid(cells, 492 + index * 165, 324, 96)}`).join('')}`
  }
  return ''
}
