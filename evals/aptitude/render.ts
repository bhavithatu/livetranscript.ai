import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import type { AptitudeFixture } from './fixtures'
import { aptitudeVisualDiagram } from './visualRender'

const require = createRequire(import.meta.url)
const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const arrow = (x: number, y: number, rotation: number) => `<g transform="translate(${x} ${y}) rotate(${rotation})"><path d="M-18 28H18V-8H36L0-42L-36-8H-18Z" fill="#1e40af"/></g>`
const dots = (count: number, x: number) => `<rect x="${x}" y="300" width="100" height="90" rx="8" fill="#eef2ff" stroke="#62718b"/>${Array.from({ length: count }, (_, i) => `<circle cx="${x + 22 + i % 3 * 27}" cy="${324 + Math.floor(i / 3) * 32}" r="8" fill="#1e40af"/>`).join('')}`

export function aptitudeFixtureSvg(fixture: AptitudeFixture): string {
  const lines = fixture.view.lines.map((line, index) => `<text x="48" y="${112 + index * 44}" font-size="24">${xml(line)}</text>`).join('')
  let diagram = aptitudeVisualDiagram(fixture)
  if (fixture.view.diagram === 'table') diagram = `<g font-size="25"><text x="100" y="330">Store</text><text x="400" y="330">Before</text><text x="650" y="330">After</text><path d="M80 345H900" stroke="#64748b"/>${[['North','80','100'],['South','50','65'],['East','100','130']].map((row,i) => row.map((cell,j) => `<text x="${[100,400,650][j]}" y="${390+i*52}">${cell}</text>`).join('')).join('')}</g>`
  if (fixture.view.diagram === 'rotation') diagram = `<text x="85" y="245" font-size="24">SOURCE</text>${arrow(135,320,0)}${[0,270,90,180].map((r,i)=>`<text x="${365+i*165}" y="245" font-size="25">${'ABCD'[i]}</text>${arrow(375+i*165,320,r)}`).join('')}`
  if (fixture.view.diagram === 'count_pattern') diagram = `<text x="48" y="260" font-size="24">Sequence</text><text x="500" y="230" font-size="24">Choices</text>${dots(1,70)}${dots(2,210)}${dots(3,350)}<text x="525" y="275" font-size="22">A</text>${dots(3,500)}<text x="675" y="275" font-size="22">B</text>${dots(4,650)}<text x="825" y="275" font-size="22">C</text>${dots(5,800)}`
  const content = `<rect width="1080" height="640" fill="#f8fafc"/><rect width="1080" height="62" fill="#dbeafe"/><g font-family="DejaVu Sans Mono, monospace" fill="#0f172a"><text x="48" y="40" font-size="20">OWNED APTITUDE PRACTICE FIXTURE</text>${lines}${diagram}${fixture.view.incomplete ? '<rect x="20" y="75" width="8" height="410" fill="#e2e8f0"/>' : ''}</g>`
  if (fixture.view.layout === 'large_page') {
    // Preserve a desktop-sized screenshot with a much smaller question region.
    // This paired case exposes destructive whole-screen downscaling in capture paths.
    return `<svg xmlns="http://www.w3.org/2000/svg" width="2560" height="1600" viewBox="0 0 2560 1600"><rect width="2560" height="1600" fill="#fff"/><rect width="2560" height="72" fill="#e2e8f0"/><text x="40" y="47" font-family="DejaVu Sans Mono, monospace" font-size="24" fill="#475569">Practice workspace</text><g transform="translate(929 450) scale(0.65)">${content}</g></svg>`
  }
  const height = fixture.view.layout === 'cropped_choices' ? 528 : 640
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="${height}" viewBox="0 0 1080 ${height}">${content}</svg>`
}
export async function renderAptitudeFixture(fixture: AptitudeFixture): Promise<{ png: Buffer; sha256: string }> {
  const fromNext = createRequire(require.resolve('next/package.json'))
  const sharp = fromNext('sharp') as (input: Buffer) => { png(): { toBuffer(): Promise<Buffer> } }
  const png = await sharp(Buffer.from(aptitudeFixtureSvg(fixture))).png().toBuffer()
  return { png, sha256: createHash('sha256').update(png).digest('hex') }
}
