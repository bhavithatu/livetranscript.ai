import { describe, expect, it } from 'vitest'
import { calculateExpression, numericAnswer, numbersAgree } from './calculator'
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
