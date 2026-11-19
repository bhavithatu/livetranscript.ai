import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { it } from 'vitest'
import { APTITUDE_SELECTION_FIXTURES, APTITUDE_SELECTION_FIXTURE_HASH, renderSelectionFixture } from './selectionFixtures'

it.skipIf(process.env.APTITUDE_SELECTION_PREPARE !== '1')('renders the frozen original selection scenarios without provider calls', async () => {
  const directory = resolve(process.env.APTITUDE_SELECTION_OUTPUT_DIRECTORY ?? 'benchmark-results/aptitude-selection-fixtures')
  await mkdir(directory, { recursive: true })
  const images = []
  for (const fixture of APTITUDE_SELECTION_FIXTURES) {
    const { png, sha256 } = await renderSelectionFixture(fixture)
    const file = `${fixture.id}.png`
    await writeFile(resolve(directory, file), png)
    images.push({ id: fixture.id, domain: fixture.domain, file, sha256 })
  }
  await writeFile(resolve(directory, 'manifest.json'), JSON.stringify({ fixtureHash: APTITUDE_SELECTION_FIXTURE_HASH, images }, null, 2) + '\n')
  console.info(`Prepared ${images.length} original selection images in ${directory}. Fixture hash: ${APTITUDE_SELECTION_FIXTURE_HASH}. No provider calls were made.`)
})
