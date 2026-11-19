import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBehavioralSession, type BehavioralSessionController } from '@/lib/behavioral/useBehavioralSession'
import { BehavioralContextPanel } from './BehavioralContextPanel'
import { useEffect } from 'react'

let session: BehavioralSessionController
const beforeChange = vi.fn()
function Harness({ question }: { question: string }) {
  const current = useBehavioralSession()
  useEffect(() => { session = current }, [current])
  return <BehavioralContextPanel session={current} latestQuestion={question} onBeforeChange={beforeChange} onNewRound={() => current.reset()} />
}
afterEach(() => { cleanup(); beforeChange.mockReset() })

describe('behavioral answer recording', () => {
  it('preserves an open actual-answer draft when automatic questions advance', () => {
    const view = render(<Harness question="How did you measure the improvement?" />)
    act(() => session.recordSuggestion(session.snapshot(), 'How did you measure the improvement?', 'An unconfirmed 40% improvement.'))
    fireEvent.click(screen.getByRole('button', { name: 'Record my answer' }))
    fireEvent.change(screen.getByLabelText('Your actual answer or selected option text'), { target: { value: 'I measured 14%, using the same baseline.' } })
    view.rerender(<Harness question="What would you change next time?" />)
    expect((screen.getByLabelText('Question', { exact: true }) as HTMLTextAreaElement).value).toBe('How did you measure the improvement?')
    expect((screen.getByLabelText('Your actual answer or selected option text') as HTMLTextAreaElement).value).toBe('I measured 14%, using the same baseline.')
    fireEvent.click(screen.getByRole('button', { name: 'Save actual answer' }))
    expect(beforeChange).toHaveBeenCalledOnce()
    expect(session.round.records).toEqual([
      expect.objectContaining({ kind: 'ai_suggestion', text: 'An unconfirmed 40% improvement.' }),
      expect.objectContaining({ kind: 'confirmed_answer', question: 'How did you measure the improvement?', text: 'I measured 14%, using the same baseline.' }),
    ])
  })

  it('records an explicit correction and preserves the company used for an earlier suggestion', () => {
    render(<Harness question="How do you handle ambiguity?" />)
    act(() => {
      session.updateProfile({ company: 'Company A' })
      session.addRecord({ kind: 'confirmed_answer', question: 'How do you handle ambiguity?', text: 'I plan everything before starting.' })
      session.recordSuggestion(session.snapshot(), 'How do you handle ambiguity?', 'A draft based on the first company.')
      session.updateProfile({ company: 'Company B' })
    })
    const original = session.round.records[0]
    fireEvent.click(screen.getByText('Round history and controls (2)'))
    expect(screen.getByText(/Context when generated: Company A/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Correct this' }))
    fireEvent.change(screen.getByLabelText('Corrected answer and what changed'), { target: { value: 'Correction: I plan the risks first, then iterate with feedback.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }))
    expect(session.round.records.at(-1)).toMatchObject({ kind: 'correction', supersedes: original.id, text: 'Correction: I plan the risks first, then iterate with feedback.' })
    expect(session.round.records[0].text).toBe('I plan everything before starting.')
    expect(session.snapshot().profile.company).toBe('Company B')
  })
})
