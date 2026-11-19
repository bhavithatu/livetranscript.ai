import { expect, it } from 'vitest'
import { BEHAVIORAL_LIVE_FIXTURES, behavioralFixtureSvg, scoreBehavioralResponse } from './behavioralFixtures'
import { behavioralCheckEnabled, behavioralCheckPlan } from './behavioralPlan'
import type { AptitudeObservation } from '@/lib/aptitude/schema'
const env = { VERCEL_ENV: 'preview', LT_RUN_BEHAVIORAL_CHECK: '1', BEHAVIORAL_CHECK_MODELS: 'anthropic:claude-sonnet-5-5,openai:gpt-6.2-sol', BEHAVIORAL_CHECK_MAX_CALLS: '6' }
it('requires explicit preview opt-in, exact models and exact six-call cap', () => {
  expect(behavioralCheckPlan(env).plannedCalls).toBe(6)
  for (const changed of [{ VERCEL_ENV: 'production' }, { VERCEL_ENV: undefined }, { LT_RUN_BEHAVIORAL_CHECK: undefined }, { BEHAVIORAL_CHECK_MODELS: 'openai:gpt-6.2-sol' }, { BEHAVIORAL_CHECK_MAX_CALLS: '7' }]) {
    expect(() => behavioralCheckPlan({ ...env, ...changed })).toThrow()
  }
  expect(behavioralCheckEnabled({ VERCEL_ENV: 'preview' })).toBe(false)
  expect(behavioralCheckEnabled({ LT_RUN_BEHAVIORAL_CHECK: '1' })).toBe(false)
})
function observation(index = 0): AptitudeObservation {
  const fixture = BEHAVIORAL_LIVE_FIXTURES[index]
  return { category: fixture.category, status: fixture.incomplete ? 'needs_capture' : 'unsupported', answer: null,
    question: { stem: fixture.lines.join(' '), instructions: [], passage: null, responseType: 'single_choice',
      options: fixture.choices.slice(0, fixture.incomplete ? 2 : undefined).map((text, i) => ({ id: 'ABCDE'[i], label: 'ABCDE'[i], text })), missingEvidence: fixture.incomplete ? ['Choices C, D and E are outside the image'] : [] },
    message: fixture.incomplete ? 'Capture all five choices.' : 'Suggested response: Disagree if you generally feel comfortable asking for help.\nWhat this may assess: This may explore collaboration.\nConstructive behavior: Ask specific questions when support is needed.',
  }
}
it('reports format/conditional evidence without claiming employer correctness', () => {
  const score = scoreBehavioralResponse(BEHAVIORAL_LIVE_FIXTURES[0], observation())
  expect(score.formatAndBoundaryPassed).toBe(true)
  expect(score.manualReviewRequired).toBe(true)
  expect(scoreBehavioralResponse(BEHAVIORAL_LIVE_FIXTURES[0], { ...observation(), message: 'Suggested response: You are definitely collaborative. Pick the ideal response.\nWhat this may assess: Collaboration.\nConstructive behavior: Ask for help.' }).formatAndBoundaryPassed).toBe(false)
})
it('rejects invented selected personal answers and incomplete behavioral capture advice', () => {
  expect(scoreBehavioralResponse(BEHAVIORAL_LIVE_FIXTURES[0], { ...observation(), answer: {} }).schemaValid).toBe(false)
  expect(scoreBehavioralResponse(BEHAVIORAL_LIVE_FIXTURES[2], observation(2)).formatAndBoundaryPassed).toBe(true)
  expect(scoreBehavioralResponse(BEHAVIORAL_LIVE_FIXTURES[2], { ...observation(2), status: 'unsupported' }).formatAndBoundaryPassed).toBe(false)
})
it('renders a clipped scale with an explicit five-option requirement', () => {
  expect(behavioralFixtureSvg(BEHAVIORAL_LIVE_FIXTURES[2])).toContain('height="320"')
  expect(behavioralFixtureSvg(BEHAVIORAL_LIVE_FIXTURES[2])).toContain('FIVE responses')
  expect(behavioralFixtureSvg(BEHAVIORAL_LIVE_FIXTURES[2])).toContain('y="432"')
})
