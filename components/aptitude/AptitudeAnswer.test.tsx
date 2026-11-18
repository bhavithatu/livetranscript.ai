import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseAptitudeResult, type AptitudeResult } from '@/lib/aptitude/schema'
import type { AptitudeSessionEntry } from '@/lib/aptitude/useAptitudeSession'
import { AptitudeAnswer } from './AptitudeAnswer'
import { comparisonFixture } from './comparisonTestFixtures'

const base: AptitudeResult = {
  schemaVersion: 1, captureId: 'sample', questionVersion: 1, questionId: 'a'.repeat(64), sourceHash: 'b'.repeat(64),
  category: 'numerical', status: 'solved', question: {
    stem: 'A team completed 72 tasks and then 90 tasks. What was the percentage increase?', instructions: [], passage: null,
    options: [{ id: 'a', label: 'A', text: '20%' }, { id: 'b', label: 'B', text: '25%' }], responseType: 'single_choice', missingEvidence: [],
  }, answer: { selectedOptionIds: ['b'], value: '25', unit: '%', summary: 'The increase is 25%.',
    workedExplanation: ['Subtract 72 from 90 to get 18.', 'Divide 18 by the original 72 and multiply by 100.'],
    evidence: ['The captured quantities are 72 and 90.'], calculation: { expression: '(90-72)/72*100', claimedValue: 25, decimalPlaces: null } },
  verification: { method: 'arithmetic', outcome: 'passed', notes: ['The calculation equals 25.'] }, model: 'test-model', provider: 'openai', durationMs: 2400, message: null,
}

function entry(result: AptitudeResult): AptitudeSessionEntry {
  return { id: 'sample', capture: { id: 'sample', image: 'data:image/png;base64,AA==', capturedAt: 1_700_000_000_000, width: 1000, height: 600, sourceHash: 'local' },
    category: 'numerical', strategy: 'compare', questionVersion: 1, status: result.status === 'error' ? 'error' : 'complete',
    result: parseAptitudeResult(result), error: result.status === 'error' ? result.message : null,
    startedAt: 1_700_000_000_000, finishedAt: 1_700_000_002_500, elapsedMs: 2500 }
}
const actions = { onRetry: vi.fn(), onStop: vi.fn(), onCapture: vi.fn() }
afterEach(cleanup)

describe('model comparison results', () => {
  it.each(['agreement', 'majority'] as const)('groups the supported %s answer before inspectable model cards', (decision) => {
    render(<AptitudeAnswer entry={entry(comparisonFixture(base, decision))} index={0} {...actions} />)
    const region = screen.getByRole('region', { name: 'Model comparison' })
    expect(within(region).getByRole('heading', { name: decision === 'agreement' ? 'Models agree' : 'Majority agreement' })).toBeTruthy()
    const suggested = within(region).getByRole('heading', { name: 'B — 25%' })
    const cards = within(region).getAllByRole('article')
    expect(cards).toHaveLength(decision === 'agreement' ? 2 : 3)
    expect(suggested.compareDocumentPosition(cards[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const selected = within(region).getByRole('article', { name: 'anthropic:test-model-b' })
    expect(selected.getAttribute('data-selected')).toBe('true')
    expect(within(selected).getByText('Answer shown')).toBeTruthy()
    expect(within(selected).getByText('Response time 2.2 s')).toBeTruthy()
    expect(within(selected).getByText(/Image reading, formula choice, units and meaning still need review/)).toBeTruthy()
    expect(within(region).getByText(/does not prove the answer is correct/)).toBeTruthy()
    if (decision === 'majority') {
      const other = within(region).getByRole('article', { name: 'openai:test-model-c' })
      expect(other.getAttribute('data-selected')).toBe('false')
      expect(within(other).getByText('A — 20%')).toBeTruthy()
      fireEvent.click(within(other).getByText('Explanation & evidence'))
      expect((other.querySelector('details') as HTMLDetailsElement).open).toBe(true)
      expect(within(other).getByText('Divide by the later value: 18 ÷ 90 × 100 = 20%.')).toBeTruthy()
    }
  })

  it('withholds a recommendation on disagreement while keeping both individual answers and reasoning visible', () => {
    render(<AptitudeAnswer entry={entry(comparisonFixture(base, 'disagreement'))} index={0} {...actions} />)
    const region = screen.getByRole('region', { name: 'Model comparison' })
    expect(within(region).getByRole('heading', { name: 'Models disagree' })).toBeTruthy()
    expect(screen.queryByText('Suggested answer')).toBeNull()
    expect(within(region).getByText(/No answer is selected/)).toBeTruthy()
    const first = within(region).getByRole('article', { name: 'openai:test-model-a' })
    const second = within(region).getByRole('article', { name: 'anthropic:test-model-b' })
    expect(within(first).getByText('B — 25%')).toBeTruthy()
    expect(within(second).getByText('A — 20%')).toBeTruthy()
    expect((first.querySelector('details') as HTMLDetailsElement).open).toBe(true)
    expect((second.querySelector('details') as HTMLDetailsElement).open).toBe(true)
    expect(region.querySelector('[data-selected="true"]')).toBeNull()
  })

  it('shows partial results and actual timeout errors without treating one usable model as agreement', () => {
    const result = comparisonFixture(base, 'insufficient')
    const view = render(<AptitudeAnswer entry={entry(result)} index={0} retryStrategy="single" {...actions} />)
    const region = screen.getByRole('region', { name: 'Model comparison' })
    expect(within(region).getByRole('heading', { name: 'Comparison incomplete' })).toBeTruthy()
    expect(screen.queryByText('Suggested answer')).toBeNull()
    expect(within(region).getByText('B — 25%')).toBeTruthy()
    const timedOut = within(region).getByRole('article', { name: 'anthropic:test-model-b' })
    expect(within(timedOut).getByText('Timed out')).toBeTruthy()
    expect(within(timedOut).getByText('Response time 25.0 s')).toBeTruthy()
    expect(within(timedOut).getByText('The model did not finish before the deadline.')).toBeTruthy()
    expect(screen.getByText('This retry uses Single model.')).toBeTruthy()
    const allFailed: AptitudeResult = { ...result, status: 'error', message: 'No models completed.', comparison: {
      ...result.comparison!, agreementCount: 0, candidates: result.comparison!.candidates.map((candidate, index) => index === 0
        ? { ...candidate, status: 'failed', model: null, observation: null, verification: null, error: 'The provider could not complete the request.' }
        : candidate),
    } }
    view.rerender(<AptitudeAnswer entry={entry(allFailed)} index={0} {...actions} />)
    expect(screen.getByRole('alert').textContent).toBe('No models completed.')
    expect(screen.getByText('The provider could not complete the request.')).toBeTruthy()
    expect(screen.queryByText('B — 25%')).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry this capture' })).toBeTruthy()
  })
})
