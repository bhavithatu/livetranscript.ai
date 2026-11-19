import { render, screen, cleanup, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AnswerGuidance } from './AnswerGuidance'
import { AptitudeComparison } from './AptitudeComparison'
import { BEHAVIORAL_PRACTICE } from '@/lib/aptitude/behavioralFixtures'
import { parseBehavioralAdvice } from '@/lib/aptitude/behavioralAdvice'
import { behavioralObservations } from '@/lib/aptitude/behavioral'
import { parseAptitudeObservation, type AptitudeComparisonCandidate } from '@/lib/aptitude/schema'
import { solvedObservation } from '@/lib/aptitude/testFixtures'

const candidate = (i = 0): AptitudeComparisonCandidate => ({
  modelId: 'openai:fixture', model: 'fixture', provider: 'openai', status: 'complete',
  observation: BEHAVIORAL_PRACTICE[i].observation, verification: { method: 'none', outcome: 'not_run', notes: [] }, durationMs: 0, error: null,
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it.each([0, 1])('explains behavioral example %i without inventing a preference or confidence', index => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  const c = candidate(index)
  expect(parseAptitudeObservation(c.observation)).toEqual(c.observation)
  render(<AnswerGuidance candidates={[c]}/>)
  expect(screen.getByRole('region', { name: 'Behavioral guidance' })).toBeTruthy()
  for (const text of Object.values(parseBehavioralAdvice(c.observation!.message!)!)) expect(screen.getByText(text)).toBeTruthy()
  expect(screen.getByText(/Correctness confidence: Not applicable/)).toBeTruthy()
  expect(screen.queryByText(/\d+\/100/)).toBeNull()
  expect(screen.queryByRole('button')).toBeNull()
  expect(screen.queryByText(/Answer now|Skip for now|Review first/)).toBeNull()
  expect(fetch).not.toHaveBeenCalled()
})
it('does not show failed answer comparison for two behavioral explanations', () => {
  render(<AptitudeComparison comparison={{ decision: 'insufficient', selectedModelId: null, agreementCount: 0, notes: [], candidates: [candidate(), { ...candidate(), provider: 'anthropic', modelId: 'anthropic:fixture' }] }}/>)
  expect(screen.getAllByRole('region', { name: 'Behavioral guidance' })).toHaveLength(1)
  expect(screen.queryByText('Comparison incomplete')).toBeNull()
})
it('preserves the objective answer when models disagree on the category', () => {
  const cognitive = { ...candidate(), modelId: 'anthropic:fixture', observation: solvedObservation() }
  expect(behavioralObservations([candidate(), cognitive])).toBeNull()
  render(<AnswerGuidance candidates={[candidate(), cognitive]}/>)
  expect(screen.getByRole('heading', { name: 'B — 25%' })).toBeTruthy()
})
it('keeps missing behavioral content in the capture recovery flow', () => {
  const c = candidate()
  c.observation = { ...c.observation!, status: 'needs_capture', question: { ...c.observation!.question!, missingEvidence: ['The response scale is cut off'] } }
  expect(behavioralObservations([c])).toBeNull()
  render(<AnswerGuidance candidates={[c]}/>)
  expect(screen.queryByRole('region', { name: 'Behavioral guidance' })).toBeNull()
})
it('marks partial comparison guidance as pending', () => {
  render(<AnswerGuidance candidates={[candidate()]} active/>)
  expect(screen.getByText('More analysis pending')).toBeTruthy()
})

it('explains every displayed agreement choice without selecting one for the user', () => {
  render(<AnswerGuidance candidates={[candidate()]}/>)
  expect(screen.getByRole('region', { name: 'How to choose your response' })).toBeTruthy()
  for (const option of BEHAVIORAL_PRACTICE[0].observation.question!.options) {
    expect(screen.getByText(`${option.text}:`)).toBeTruthy()
  }
  expect(screen.queryByRole('button')).toBeNull()
})
it('shows explanatory responses for other question types instead of an unsupported dead end', () => {
  const c = candidate()
  c.observation = { ...c.observation!, category: 'unknown', message: 'The visible instructions say to drag the blue circle into the matching outline.' }
  render(<AptitudeComparison comparison={{ decision: 'insufficient', selectedModelId: null, agreementCount: 0, notes: [], candidates: [c, { ...c, modelId: 'anthropic:fixture', provider: 'anthropic' }] }}/>)
  expect(screen.getByRole('region', { name: 'Question response' })).toBeTruthy()
  expect(within(screen.getByRole('region', { name: 'Question response' })).getByText(c.observation.message!)).toBeTruthy()
  expect(screen.queryByText(/unsupported/i)).toBeNull()
  expect(screen.queryByText('No reliable answer yet')).toBeNull()
  expect(screen.queryByText('Comparison incomplete')).toBeNull()
})

it('keeps older behavioral explanations readable', () => {
  const c = candidate()
  c.observation = { ...c.observation!, message: 'Reflect on a recent example of working with a colleague.' }
  render(<AnswerGuidance candidates={[c]}/>)
  expect(screen.getByRole('region', { name: 'Question explanation' })).toBeTruthy()
  expect(screen.getByText(c.observation.message!)).toBeTruthy()
})
it('keeps distinct model advice visible instead of inventing agreement', () => {
  const first = candidate(), second = candidate(1)
  render(<AnswerGuidance candidates={[first, { ...second, modelId: 'anthropic:fixture', provider: 'anthropic' }]}/>)
  expect(screen.getByRole('region', { name: 'Behavioral response 1' })).toBeTruthy()
  expect(screen.getByRole('region', { name: 'Behavioral response 2' })).toBeTruthy()
  expect(screen.queryByText('Models agree')).toBeNull()
})

it('identifies the provider of each distinct behavioral suggestion', () => {
  const first = candidate(), second = candidate(1)
  render(<AnswerGuidance candidates={[first, { ...second, modelId: 'anthropic:fixture', provider: 'anthropic' }]}/>)
  expect(within(screen.getByRole('region', { name: 'Behavioral response 1' })).getByText('Response from OpenAI · fixture')).toBeTruthy()
  expect(within(screen.getByRole('region', { name: 'Behavioral response 2' })).getByText('Response from Claude · fixture')).toBeTruthy()
  expect(screen.getByText(/have not been combined into one recommendation/)).toBeTruthy()
})
it('keeps provider failure visible alongside a usable behavioral response', () => {
  const failed: AptitudeComparisonCandidate = { ...candidate(), provider: 'anthropic', modelId: 'anthropic:fixture', status: 'timed_out', observation: null, verification: null, error: 'The provider timed out.' }
  render(<AptitudeComparison comparison={{ decision: 'insufficient', selectedModelId: null, agreementCount: 0, notes: [], candidates: [candidate(), failed] }}/>)
  expect(screen.getByRole('status').textContent).toBe('1 of 2 models returned a response.')
  expect(screen.getByText('Claude timed out. The available explanation is shown above.')).toBeTruthy()
  expect(screen.getByText('Model response details')).toBeTruthy()
  expect(screen.getByRole('region', { name: 'Behavioral guidance' })).toBeTruthy()
})
it('keeps pending model status after the first explanatory response arrives', () => {
  render(<AptitudeComparison active progress={{ models: [{ modelId: 'openai:fixture', provider: 'openai', model: 'fixture' }, { modelId: 'anthropic:fixture', provider: 'anthropic', model: 'fixture' }], candidates: [candidate()] }}/>)
  expect(screen.getByRole('status').textContent).toBe('1 of 2 models returned a response. More analysis is pending.')
  expect(screen.getByText('Model response details')).toBeTruthy()
})
it('attributes an identical explanation to both providers without calling it agreement', () => {
  render(<AnswerGuidance candidates={[candidate(), { ...candidate(), modelId: 'anthropic:fixture', provider: 'anthropic' }]}/>)
  expect(screen.getByText('Response from OpenAI · fixture · Claude · fixture')).toBeTruthy()
  expect(screen.getAllByRole('region', { name: 'Behavioral response' })).toHaveLength(1)
  expect(screen.queryByText('Models agree')).toBeNull()
})
