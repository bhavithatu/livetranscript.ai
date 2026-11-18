import { createHash } from 'node:crypto'
import { APTITUDE_SYSTEM_PROMPT } from '@/lib/aptitude/prompt'
import { APTITUDE_OBSERVATION_JSON_SCHEMA } from '@/lib/aptitude/schema'
import { APTITUDE_FIXTURES } from './fixtures'
import { renderAptitudeFixture } from './render'

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
export async function prepareAptitudeFixtures() {
  const rendered = await Promise.all(APTITUDE_FIXTURES.map(async fixture => ({ fixture, ...await renderAptitudeFixture(fixture) })))
  const manifest = { version: 1, suiteHash: hash(JSON.stringify(APTITUDE_FIXTURES)), promptHash: hash(APTITUDE_SYSTEM_PROMPT), schemaHash: hash(JSON.stringify(APTITUDE_OBSERVATION_JSON_SCHEMA)),
    images: rendered.map(({ fixture, sha256 }) => ({ id: fixture.id, split: fixture.split, sha256 })) }
  return { rendered, manifest }
}
