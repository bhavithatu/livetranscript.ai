import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseAptitudeResult, type AptitudeResult } from '@/lib/aptitude/schema'
import type { AptitudeSessionEntry } from '@/lib/aptitude/useAptitudeSession'
import { AptitudeAnswer } from './AptitudeAnswer'
import { comparisonFixture } from './comparisonTestFixtures'
import { comparisonReviewQuestion, selectAptitudeComparison } from '@/lib/aptitude/comparison'

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
  it.each(['agreement', 'majority'] as const)('puts both %s answers before the combined decision and keeps checks collapsed', (decision) => {
    const result = comparisonFixture(base, decision)
    result.comparison!.candidates[0].observation!.answer!.confidence = 86
    result.comparison!.candidates[1].observation!.answer!.confidence = 92
    // The selected response shares the candidate answer by construction.
    render(<AptitudeAnswer entry={entry(result)} index={0} {...actions} />)
    const region = screen.getByRole('region', { name: 'Model comparison' })
    const heading = within(region).getByRole('heading', { name: decision === 'agreement' ? 'Models agree' : 'Majority agreement' })
    const cards = within(region).getAllByRole('article')
    expect(cards).toHaveLength(decision === 'agreement' ? 2 : 3)
    expect(cards[0].compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const selected = within(region).getByRole('article', { name: 'anthropic:test-model-b' })
    expect(selected.getAttribute('data-selected')).toBe('true')
    expect(within(selected).getByRole('heading', { name: 'Claude' })).toBeTruthy()
    expect(within(selected).getByText('B — 25%', { selector: 'p' })).toBeTruthy()
    expect(within(selected).getByText('92%')).toBeTruthy()
    expect(within(selected).getByText('Uncalibrated estimate')).toBeTruthy()
    expect(within(selected).getByText('Response time 2.2 s')).toBeTruthy()
    expect((selected.querySelector('details') as HTMLDetailsElement).open).toBe(false)
    fireEvent.click(within(selected).getByText('Explanation & checks'))
    expect(within(selected).getByText(/does not verify image reading, rule choice/)).toBeTruthy()
    expect(within(region).getByText(/Agreement does not prove the answer is correct/)).toBeTruthy()
    expect(screen.queryByText('Suggested answer')).toBeNull()
    expect(within(region).getAllByText(/not measured accuracy/).length).toBeGreaterThan(0)
  })

  it('keeps both individual answers and copy controls on disagreement without declaring a winner', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const result = comparisonFixture(base, 'disagreement')
    result.comparison!.candidates[1].observation!.answer!.confidence = 99
    render(<AptitudeAnswer entry={entry(result)} index={0} {...actions} />)
    const region = screen.getByRole('region', { name: 'Model comparison' })
    expect(within(region).getByRole('heading', { name: 'Models disagree' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Model answers ready' })).toBeTruthy()
    expect(screen.queryByText('Suggested answer')).toBeNull()
    expect(within(region).getByText(/No combined answer is selected/)).toBeTruthy()
    const first = within(region).getByRole('article', { name: 'openai:test-model-a' })
    const second = within(region).getByRole('article', { name: 'anthropic:test-model-b' })
    expect(within(first).getByText('B — 25%', { selector: 'p' })).toBeTruthy()
    expect(within(first).getByText('Not rated')).toBeTruthy()
    expect(within(second).getByText('A — 20%', { selector: 'p' })).toBeTruthy()
    expect(within(second).getByText('99%')).toBeTruthy()
    expect((first.querySelector('details') as HTMLDetailsElement).open).toBe(false)
    expect(region.querySelector('[data-selected="true"]')).toBeNull()
    fireEvent.click(within(second).getByRole('button', { name: 'Copy Claude answer' }))
    await within(second).findByRole('button', { name: 'Claude answer copied' })
    expect(writeText).toHaveBeenLastCalledWith('A — 20%')
    fireEvent.click(within(first).getByRole('button', { name: 'Copy OpenAI answer' }))
    await within(first).findByRole('button', { name: 'OpenAI answer copied' })
    expect(writeText).toHaveBeenLastCalledWith('B — 25%')
  })

  it('shows partial results and timeout errors without confidence on a missing answer', () => {
    const result = comparisonFixture(base, 'insufficient')
    const view = render(<AptitudeAnswer entry={entry(result)} index={0} retryStrategy="single" {...actions} />)
    const region = screen.getByRole('region', { name: 'Model comparison' })
    expect(within(region).getByRole('heading', { name: 'Comparison incomplete' })).toBeTruthy()
    expect(screen.queryByText('Suggested answer')).toBeNull()
    expect(within(region).getByText('B — 25%', { selector: 'p' })).toBeTruthy()
    const timedOut = within(region).getByRole('article', { name: 'anthropic:test-model-b' })
    expect(within(timedOut).getByText('Timed out')).toBeTruthy()
    expect(within(timedOut).getByText('Response time 25.0 s')).toBeTruthy()
    expect(within(timedOut).getByText('The model did not finish before the deadline.')).toBeTruthy()
    expect(within(timedOut).queryByText('Model confidence')).toBeNull()
    expect(within(timedOut).queryByRole('button')).toBeNull()
    expect(screen.getByText('This retry uses Single model.')).toBeTruthy()
    const allFailed: AptitudeResult = { ...result, status: 'error', message: 'No models completed.', comparison: {
      ...result.comparison!, agreementCount: 0, candidates: result.comparison!.candidates.map((candidate, index) => index === 0
        ? { ...candidate, status: 'failed', model: null, observation: null, verification: null, error: 'The provider could not complete the request.' }
        : candidate),
    } }
    view.rerender(<AptitudeAnswer entry={entry(allFailed)} index={0} {...actions} />)
    expect(screen.getByRole('alert').textContent).toBe('No models completed.')
    expect(screen.getByText('The provider could not complete the request.')).toBeTruthy()
    expect(screen.queryByText('B — 25%', { selector: 'p' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry this capture' })).toBeTruthy()
  })

  it('distinguishes matching values from reconciled evidence below the answers', () => {
    const result = comparisonFixture(base)
    const candidates = result.comparison!.candidates
    candidates[1].observation!.question!.stem = 'A different reading of the question.'
    const { comparison } = selectAptitudeComparison(candidates)
    const review = comparisonReviewQuestion(candidates)
    const unresolved: AptitudeResult = { ...result, ...review, status: 'ambiguous', answer: null, questionId: null, model: null, provider: null,
      message: 'The evidence needs review.', verification: { method: 'none', outcome: 'not_run', notes: [] }, comparison }
    render(<AptitudeAnswer entry={entry(unresolved)} index={0} {...actions} />)
    expect(screen.getByRole('heading', { name: 'Same answer, evidence needs review' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Models disagree' })).toBeNull()
    expect(screen.queryByText('Suggested answer')).toBeNull()
    expect(screen.getByText(/The answer values match, but/)).toBeTruthy()
  })

  it('shows the first validated answer and confidence while the other provider is still pending', () => {
    const comparison = comparisonFixture(base).comparison!
    const first = comparison.candidates[0]
    first.observation!.answer!.confidence = 0
    const active: AptitudeSessionEntry = { ...entry(base), result: null, status: 'analyzing', elapsedMs: null, finishedAt: null,
      progress: { sourceHash: base.sourceHash, models: comparison.candidates.map(candidate => ({ modelId: candidate.modelId, model: candidate.model!, provider: candidate.provider })), candidates: [first], firstAnswerMs: 1500 } }
    const view = render(<AptitudeAnswer entry={active} index={0} {...actions} />)
    expect(screen.getByRole('heading', { name: '1 of 2 responses ready' })).toBeTruthy()
    expect(screen.getByText('First answer 1.5 s')).toBeTruthy()
    expect(screen.getByText('B — 25%', { selector: 'p' })).toBeTruthy()
    expect(screen.getByText('0%')).toBeTruthy()
    const waiting = screen.getByRole('article', { name: 'anthropic:test-model-b' })
    expect(waiting.getAttribute('aria-busy')).toBe('true')
    expect(within(waiting).getByText('Waiting for this model…')).toBeTruthy()
    expect(within(waiting).queryByText('Model confidence')).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy OpenAI answer' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Models agree' })).toBeNull()
    view.rerender(<AptitudeAnswer entry={{ ...active, status: 'cancelled', elapsedMs: 2000 }} index={0} {...actions} />)
    expect(screen.getByText('B — 25%', { selector: 'p' })).toBeTruthy()
    expect(screen.queryByText('Waiting for this model…')).toBeNull()
    expect(screen.getByText('No completed response')).toBeTruthy()
    expect(screen.getByText(/Comparison did not finish/)).toBeTruthy()
  })

  it('preserves the first answer copy button and focus when the second result completes', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const result = comparisonFixture(base)
    const candidates = result.comparison!.candidates
    const active: AptitudeSessionEntry = { ...entry(base), result: null, status: 'analyzing', elapsedMs: null, finishedAt: null,
      progress: { sourceHash: base.sourceHash, models: candidates.map(candidate => ({ modelId: candidate.modelId, model: candidate.model!, provider: candidate.provider })), candidates: [candidates[0]], firstAnswerMs: 1500 } }
    const view = render(<AptitudeAnswer entry={active} index={0} {...actions} />)
    const button = screen.getByRole('button', { name: 'Copy OpenAI answer' })
    button.focus()
    fireEvent.click(button)
    await screen.findByRole('button', { name: 'OpenAI answer copied' })
    view.rerender(<AptitudeAnswer entry={{ ...active, status: 'complete', result, elapsedMs: 2500, finishedAt: 2500 }} index={0} {...actions} />)
    expect(screen.getByRole('button', { name: 'OpenAI answer copied' })).toBe(button)
    expect(document.activeElement).toBe(button)
    expect(screen.getByRole('button', { name: 'Copy Claude answer' })).toBeTruthy()
  })

  it('keeps copy focus while the clipboard write is pending and rejects duplicate activation', async () => {
    let finishWrite!: () => void
    const writeText = vi.fn(() => new Promise<void>(resolve => { finishWrite = resolve }))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<AptitudeAnswer entry={entry(comparisonFixture(base))} index={0} {...actions} />)
    const button = screen.getByRole('button', { name: 'Copy Claude answer' }) as HTMLButtonElement
    button.focus()
    fireEvent.click(button)
    expect(button.disabled).toBe(false)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(button)
    fireEvent.click(button)
    expect(writeText).toHaveBeenCalledTimes(1)
    await act(async () => { finishWrite() })
    expect(screen.getByRole('button', { name: 'Claude answer copied' })).toBe(button)
    expect(button.getAttribute('aria-disabled')).toBe('false')
    expect(document.activeElement).toBe(button)
    fireEvent.click(button)
    expect(writeText).toHaveBeenCalledTimes(2)
    await act(async () => { finishWrite() })
  })

  it.each(['needs_capture', 'ambiguous'] as const)('does not show confidence or copying when a model returns %s', (status) => {
    const result = comparisonFixture(base)
    const candidates = result.comparison!.candidates
    const response = { ...candidates[0], observation: { ...candidates[0].observation!, status, answer: null, message: 'Review the captured content.' } }
    const active: AptitudeSessionEntry = { ...entry(base), result: null, status: 'analyzing', elapsedMs: null, finishedAt: null,
      progress: { sourceHash: base.sourceHash, models: candidates.map(candidate => ({ modelId: candidate.modelId, model: candidate.model!, provider: candidate.provider })), candidates: [response], firstAnswerMs: null } }
    render(<AptitudeAnswer entry={active} index={0} {...actions} />)
    const card = screen.getByRole('article', { name: candidates[0].modelId })
    expect(within(card).getByText('No answer supplied')).toBeTruthy()
    expect(within(card).queryByText('Model confidence')).toBeNull()
    expect(within(card).queryByRole('button')).toBeNull()
  })

  it('shows both provider placeholders before the stream identifies the configured models', () => {
    render(<AptitudeAnswer entry={{ ...entry(base), result: null, status: 'analyzing' }} index={0} {...actions} />)
    expect(screen.getByRole('heading', { name: 'Claude' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'OpenAI' })).toBeTruthy()
    expect(screen.getAllByText('Waiting for this model…')).toHaveLength(2)
    expect(screen.queryByText('Model confidence')).toBeNull()
  })

  it('does not duplicate an unlabeled numeric choice or call arithmetic a correctness check', () => {
    const result = structuredClone(base)
    result.question!.options[1] = { id: 'b', label: '25%', text: '25%' }
    render(<AptitudeAnswer entry={entry(result)} index={0} {...actions} />)
    expect(screen.getByRole('heading', { name: '25%' })).toBeTruthy()
    expect(screen.queryByText('25% — 25%')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Calculation matches' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Check passed' })).toBeNull()
  })

  it('copies the displayed resolved answer and resets feedback for a different capture', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const view = render(<AptitudeAnswer entry={entry(base)} index={0} {...actions} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy answer' }))
    await screen.findByRole('button', { name: 'Answer copied' })
    expect(writeText).toHaveBeenCalledWith('B — 25%')
    expect(screen.getByRole('status').textContent).toContain('Copied. Choose or paste it')
    view.rerender(<AptitudeAnswer entry={{ ...entry(base), id: 'next-capture' }} index={1} {...actions} />)
    expect(screen.getByRole('button', { name: 'Copy answer' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Answer copied' })).toBeNull()
  })

  it('provides a selected manual-copy field if the browser denies clipboard access', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Not allowed'))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<AptitudeAnswer entry={entry(base)} index={0} {...actions} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy answer' }))
    const field = await screen.findByRole('textbox', { name: 'Answer to copy' }) as HTMLTextAreaElement
    expect(field.value).toBe('B — 25%')
    await waitFor(() => expect(field.selectionEnd).toBe(field.value.length))
    expect(field.selectionStart).toBe(0)
    expect(screen.getByRole('status').textContent).toContain('Clipboard access is unavailable')
    expect(screen.queryByRole('button', { name: 'Answer copied' })).toBeNull()
  })
})
