import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { it } from 'vitest'
import { prepareAptitudeFixtures } from './manifest'

it.skipIf(process.env.APTITUDE_EVAL_PREPARE !== '1')('prepare owned aptitude screenshots and an inspectable manifest (no API calls)', async () => {
  const directory = resolve('benchmark-results/aptitude-fixtures')
  await mkdir(directory, { recursive: true })
  const { rendered, manifest } = await prepareAptitudeFixtures()
  for (const { fixture, png } of rendered) await writeFile(resolve(directory, `${fixture.id}.png`), png)
  await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.info(`Prepared ${rendered.length} owned screenshots and ${resolve(directory, 'manifest.json')}. No model calls were made.`)
})
