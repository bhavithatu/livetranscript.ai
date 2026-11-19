import { expect, it } from 'vitest'
import { parseBehavioralAdvice } from './behavioralAdvice'
import { BEHAVIORAL_PRACTICE } from './behavioralFixtures'

it.each(BEHAVIORAL_PRACTICE)('extracts all advice from $title', ({ observation }) => {
  const advice = parseBehavioralAdvice(observation.message!)!
  expect(advice.suggestedResponse.length).toBeGreaterThan(20)
  expect(advice.assessedBehavior).toMatch(/may explore/)
  expect(advice.constructiveBehavior.length).toBeGreaterThan(20)
  expect(observation.message!.length).toBeLessThanOrEqual(1000)
})
it.each([
  'Legacy explanation without labels.',
  'Suggested response: Agree\nWhat this may assess: Teamwork',
  'Suggested response: Agree\nSuggested response: Disagree\nConstructive behavior: Collaborate',
  'Suggested response: \nWhat this may assess: Teamwork\nConstructive behavior: Collaborate',
  'Do not discard me.\nSuggested response: Agree\nWhat this may assess: Teamwork\nConstructive behavior: Collaborate',
])('falls back to the intact message for incomplete or ambiguous formatting', message => {
  expect(parseBehavioralAdvice(message)).toBeNull()
})
it('preserves multiline explanations and accepts label reordering', () => {
  expect(parseBehavioralAdvice('What this may assess: Prioritization.\nA tentative interpretation.\nConstructive behavior: Discuss priorities.\nSuggested response: Option B.')).toEqual({
    suggestedResponse: 'Option B.', assessedBehavior: 'Prioritization.\nA tentative interpretation.', constructiveBehavior: 'Discuss priorities.',
  })
})
