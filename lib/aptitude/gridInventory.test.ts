import { describe, expect, it } from 'vitest'
import { APTITUDE_OBSERVATION_JSON_SCHEMA, parseAptitudeObservation, type AptitudeGridInventory } from './schema'
import { solvedGridObservation, solvedObservation } from './testFixtures'

describe('literal grid inventory contract', () => {
  it('preserves exact cells, missing markers, and empty panels without predicting missing contents', () => {
    const observation = solvedGridObservation()
    observation.answer!.gridInventory!.panels[0].filledCells = []
    const parsed = parseAptitudeObservation(observation)
    expect(parsed).toEqual(observation)
    expect(parsed.answer!.gridInventory!.panels[0].filledCells).toEqual([])
    expect(parsed.answer!.gridInventory!.panels[3].filledCells).toBeNull()
  })
  it('keeps earlier omitted fields absent and accepts an explicit inapplicable null', () => {
    const legacy = solvedObservation()
    expect(parseAptitudeObservation(legacy).answer).not.toHaveProperty('gridInventory')
    legacy.answer!.gridInventory = null
    expect(parseAptitudeObservation(legacy).answer).toHaveProperty('gridInventory', null)
    expect(parseAptitudeObservation(legacy).answer).not.toHaveProperty('numericPattern')
  })
  it('accepts record ordering differences without dropping their literal cell inventory', () => {
    const observation = solvedGridObservation()
    const inventory = observation.answer!.gridInventory!
    inventory.panels.reverse(); inventory.options.reverse(); inventory.options[1].filledCells.reverse()
    expect(parseAptitudeObservation(observation).answer!.gridInventory).toEqual(inventory)
  })
  it.each([
    ['zero dimension', (grid: AptitudeGridInventory) => { grid.rows = 0 }],
    ['fractional dimension', (grid: AptitudeGridInventory) => { grid.cellRows = 1.5 }],
    ['oversize dimension', (grid: AptitudeGridInventory) => { grid.cellColumns = 9 }],
    ['nonfinite dimension', (grid: AptitudeGridInventory) => { grid.rows = Infinity }],
    ['too many source panels', (grid: AptitudeGridInventory) => { grid.rows = 8; grid.columns = 8; grid.panels = Array.from({ length: 64 }, (_, index) => ({ row: Math.floor(index / 8) + 1, column: index % 8 + 1, filledCells: [] })) }],
    ['missing source panel', (grid: AptitudeGridInventory) => { grid.panels.pop() }],
    ['extra source panel', (grid: AptitudeGridInventory) => { grid.panels.push({ row: 1, column: 1, filledCells: [] }) }],
    ['duplicate panel address', (grid: AptitudeGridInventory) => { grid.panels[1].column = 1 }],
    ['out-of-range panel', (grid: AptitudeGridInventory) => { grid.panels[1].column = 3 }],
    ['all panels missing', (grid: AptitudeGridInventory) => { grid.panels.forEach(panel => { panel.filledCells = null }) }],
    ['duplicate occupied cell', (grid: AptitudeGridInventory) => { grid.panels[0].filledCells = ['r1c1', 'r1c1'] }],
    ['out-of-range source cell', (grid: AptitudeGridInventory) => { grid.panels[0].filledCells = ['r3c1'] }],
    ['zero-based cell', (grid: AptitudeGridInventory) => { grid.panels[0].filledCells = ['r0c1'] }],
    ['noncanonical cell', (grid: AptitudeGridInventory) => { grid.panels[0].filledCells = ['R1C1'] }],
    ['missing choice', (grid: AptitudeGridInventory) => { grid.options.pop() }],
    ['duplicate choice ID', (grid: AptitudeGridInventory) => { grid.options[1].optionId = 'A' }],
    ['unknown choice ID', (grid: AptitudeGridInventory) => { grid.options[1].optionId = 'invented' }],
    ['out-of-range option cell', (grid: AptitudeGridInventory) => { grid.options[1].filledCells = ['r1c3'] }],
    ['duplicate option cell', (grid: AptitudeGridInventory) => { grid.options[1].filledCells = ['r2c2', 'r2c2'] }],
  ])('rejects %s before publishing an answer', (_, mutate) => {
    const observation = solvedGridObservation()
    mutate(observation.answer!.gridInventory!)
    expect(() => parseAptitudeObservation(observation)).toThrow()
  })
  it('requires ID mapping even when the visible label differs from the generated ID', () => {
    const observation = solvedGridObservation()
    observation.question!.options[1].id = 'second-choice'
    observation.answer!.selectedOptionIds = ['second-choice']
    expect(() => parseAptitudeObservation(observation)).toThrow(/every visible option ID/)
    observation.answer!.gridInventory!.options[1].optionId = 'second-choice'
    expect(parseAptitudeObservation(observation).answer!.gridInventory!.options[1].optionId).toBe('second-choice')
  })
  it('rejects extra fields and null choice inventories rather than accepting fabricated missing-cell contents', () => {
    const observation = solvedGridObservation()
    const inventory = observation.answer!.gridInventory!
    for (const malformed of [
      { ...inventory, predictedCells: ['r2c2'] },
      { ...inventory, panels: inventory.panels.map((panel, index) => index === 3 ? { ...panel, predictedCells: ['r2c2'] } : panel) },
      { ...inventory, options: inventory.options.map((option, index) => index === 1 ? { ...option, filledCells: null } : option) },
    ]) expect(() => parseAptitudeObservation({ ...observation, answer: { ...observation.answer, gridInventory: malformed } })).toThrow()
  })
  it('does not permit a typed inventory to publish an unreadable or cropped answer', () => {
    const observation = solvedGridObservation()
    observation.question!.missingEvidence = ['The last option is cropped.']
    expect(() => parseAptitudeObservation(observation)).toThrow(/complete evidence/)
    expect(() => parseAptitudeObservation({ ...observation, status: 'needs_capture', message: 'Capture all options.' })).toThrow(/cannot publish/)
  })
})

describe('portable provider grid schema', () => {
  it('requires a nullable grid field and strict records using the common structured-output subset', () => {
    const schema = APTITUDE_OBSERVATION_JSON_SCHEMA as unknown as Record<string, unknown>
    const allowed = new Set(['type', 'description', 'properties', 'required', 'additionalProperties', 'items', 'anyOf', 'enum'])
    function inspect(value: Record<string, unknown>) {
      expect(Object.keys(value).every(key => allowed.has(key))).toBe(true)
      if (value.type === 'object') {
        const properties = value.properties as Record<string, Record<string, unknown>>
        expect(value.additionalProperties).toBe(false)
        expect(value.required).toEqual(Object.keys(properties))
        Object.values(properties).forEach(inspect)
      }
      if (value.items) inspect(value.items as Record<string, unknown>)
      if (value.anyOf) (value.anyOf as Record<string, unknown>[]).forEach(inspect)
    }
    inspect(schema)
    const answer = (schema.properties as Record<string, { anyOf: Record<string, unknown>[] }>).answer.anyOf[0]
    expect(answer.required).toContain('gridInventory')
    const grid = (answer.properties as Record<string, { anyOf: Record<string, unknown>[] }>).gridInventory
    expect(grid.anyOf[1]).toEqual({ type: 'null' })
    expect(grid.anyOf[0].required).toEqual(['rows', 'columns', 'cellRows', 'cellColumns', 'panels', 'options'])
  })
})
