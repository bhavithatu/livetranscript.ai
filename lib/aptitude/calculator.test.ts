import { describe, expect, it } from 'vitest'
import { calculateExpression, calculationClaimAgrees, numericAnswer, numbersAgree } from './calculator'
import { verifyAptitudeObservation } from './verify'
import { solvedObservation } from './testFixtures'

describe('restricted arithmetic verification', () => {
  it('uses exact decimal arithmetic, ordinary precedence, percent and bounded powers', () => {
    expect(calculateExpression('0.1+0.2')).toEqual({ value: 0.3, exact: '3/10' })
    expect(calculateExpression('(100-80)/80*100').value).toBe(25)
    expect(calculateExpression('200*15%').value).toBe(30)
    expect(calculateExpression('-2^2 + 2^-2').value).toBe(-3.75)
    expect(calculateExpression('-1.255', 2).value).toBe(-1.26)
    expect(calculateExpression('2^3^2').value).toBe(512)
    expect(numbersAgree(0, 1e-12)).toBe(false)
  })
  it('rejects code, division by zero and resource amplification', () => {
    for (const expression of ['process.exit()', '1/0', '0^0', '1 2', '1e9', '2^1000', '9^9^9', '2(3)', '(()', '1+'.repeat(200), '('.repeat(25) + '1' + ')'.repeat(25)]) expect(() => calculateExpression(expression)).toThrow()
  })
  it('accepts tiny decimal truncation in an unrounded calculation claim only', () => {
    const repeating = calculateExpression('(24-18)/18*100').value
    expect(calculationClaimAgrees(repeating, 33.3333333333, null)).toBe(true)
    expect(calculationClaimAgrees(1 / 3, 0.333333333333, null)).toBe(true)
    expect(calculationClaimAgrees(-1 / 3, -0.333333333333, null)).toBe(true)
    expect(numbersAgree(repeating, 33.3333333333)).toBe(false)
    expect(calculationClaimAgrees(repeating, 33.3333333333, 10)).toBe(false)
  })
  it.each([[0, 1e-12], [1e-12, 2e-12], [1e12, 1e12 + 1], [33.333333333333336, 33.333], [0.25, 0.250001], [1, Infinity], [NaN, 1]])('rejects materially different or invalid calculation claims %s and %s', (computed, claimed) => {
    expect(calculationClaimAgrees(computed, claimed, null)).toBe(false)
  })
  it.each([[4e15, 4e15 + 1], [1e15, 1e15 + 0.5], [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1], [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1], [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1]])('never equates differing large values or unsafe values %s and %s', (computed, claimed) => {
    expect(numbersAgree(computed, claimed)).toBe(false)
    expect(calculationClaimAgrees(computed, claimed, null)).toBe(false)
  })
  it('checks exact rational bounds before conversion can round them into range', () => {
    expect(calculateExpression('9007199254740991').value).toBe(Number.MAX_SAFE_INTEGER)
    expect(calculateExpression('-9007199254740991').value).toBe(-Number.MAX_SAFE_INTEGER)
    expect(numbersAgree(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toBe(true)
    for (const expression of ['9007199254740991.1', '-9007199254740991.1', '9007199254740991+1/10']) expect(() => calculateExpression(expression)).toThrow('safe display range')
  })
  it('keeps the selected answer when only a repeating intermediate calculation claim is truncated', () => {
    const item = solvedObservation()
    item.answer!.value = 'Aspen'; item.answer!.unit = null
    item.question!.options = [{ id: 'A', label: 'A', text: 'Birch' }, { id: 'B', label: 'B', text: 'Aspen' }]
    item.answer!.calculation = { expression: '(24-18)/18*100', claimedValue: 33.3333333333, decimalPlaces: null }
    expect(verifyAptitudeObservation(item)).toMatchObject({ observation: { status: 'solved' }, verification: { outcome: 'passed' } })
  })
  it('does not let claim tolerance relax exact answer or close distractor matching', () => {
    const item = solvedObservation()
    item.answer!.calculation = { expression: '25', claimedValue: 25.0000000005, decimalPlaces: null }
    item.answer!.value = '25.0000000005'
    expect(verifyAptitudeObservation(item).verification.outcome).toBe('disagreed')
    item.answer!.value = '25'
    item.question!.options[1].text = '25.0000000005%'
    expect(verifyAptitudeObservation(item).verification.outcome).toBe('disagreed')
  })
  it('parses only standalone numeric values', () => {
    expect(numericAnswer('£1,250.50')).toBe(1250.5)
    expect(numericAnswer('25%', '%')).toBe(25)
    expect(numericAnswer('15 km', 'km')).toBe(15)
    expect(numericAnswer('25', ' ')).toBe(25)
    expect(numericAnswer('answer 25')).toBeNull()
    expect(numericAnswer('1,25')).toBeNull()
  })
  it('withholds a disagreed result even when JSON and option IDs are valid', () => {
    const item = solvedObservation(); item.answer!.selectedOptionIds = ['A']
    const checked = verifyAptitudeObservation(item)
    expect(checked.observation).toMatchObject({ status: 'ambiguous', answer: null })
    expect(checked.verification.outcome).toBe('disagreed')
  })
  it('does not present arithmetic agreement or model explanation as semantic proof', () => {
    expect(verifyAptitudeObservation(solvedObservation()).verification).toMatchObject({ method: 'arithmetic', outcome: 'passed' })
    expect(verifyAptitudeObservation(solvedObservation()).verification.notes.join(' ')).toContain('does not independently verify')
    const item = solvedObservation(); item.answer!.calculation = null
    expect(verifyAptitudeObservation(item).verification.outcome).toBe('not_run')
  })
})
