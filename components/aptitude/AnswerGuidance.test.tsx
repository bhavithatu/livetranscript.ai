import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AnswerGuidance } from './AnswerGuidance'
import { solvedObservation } from '@/lib/aptitude/testFixtures'
import type { AptitudeComparisonCandidate } from '@/lib/aptitude/schema'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('shows answer, confidence and difficulty without making a network call', () => {
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch)
  const c: AptitudeComparisonCandidate={modelId:'openai:test',model:'test',provider:'openai',status:'complete',observation:solvedObservation(),verification:{method:'arithmetic',outcome:'passed',notes:[]},durationMs:1200,error:null}
  render(<AnswerGuidance candidates={[c]} />)
  expect(screen.getByRole('heading',{name:'B — 25%'})).toBeTruthy()
  expect(screen.getByText('50/100')).toBeTruthy();expect(screen.getByText('Easy')).toBeTruthy()
  expect(screen.queryByText(/Answer now|Review first|Skip for now/)).toBeNull();expect(fetch).not.toHaveBeenCalled()
})
it('shows a score but no copyable invented answer before an eligible result', () => {
  render(<AnswerGuidance candidates={[]} active />)
  expect(screen.getByText('0/100')).toBeTruthy();expect(screen.getByText('Provisional')).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})
