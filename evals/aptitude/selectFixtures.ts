import type { AptitudeFixture } from './fixtures'

/** Optional explicit subset keeps focused live regressions within a reviewable call budget. */
export function selectAptitudeFixtures(fixtures: readonly AptitudeFixture[], selection: string | undefined): readonly AptitudeFixture[] {
  if (selection === undefined) return fixtures
  const ids = selection.split(',').map(value => value.trim())
  if (!ids.length || ids.some(id => !id)) throw new Error('APTITUDE_EVAL_FIXTURES must list one or more explicit fixture IDs.')
  if (new Set(ids).size !== ids.length) throw new Error('APTITUDE_EVAL_FIXTURES cannot contain duplicate fixture IDs.')
  const available = new Set(fixtures.map(fixture => fixture.id))
  const unknown = ids.filter(id => !available.has(id))
  if (unknown.length) throw new Error(`Unknown aptitude fixture IDs: ${unknown.join(', ')}. No calls were made.`)
  const selected = new Set(ids)
  return fixtures.filter(fixture => selected.has(fixture.id))
}
