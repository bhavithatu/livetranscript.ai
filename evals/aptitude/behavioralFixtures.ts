import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { parseBehavioralAdvice } from '@/lib/aptitude/behavioralAdvice'
import { parseAptitudeObservation, type AptitudeObservation } from '@/lib/aptitude/schema'

/** Owned screenshots: prompts receive pixels only, never these rubric fields. */
export const BEHAVIORAL_LIVE_FIXTURES = [
  { id: 'behavioral-negated-help', category: 'personality', incomplete: false,
    lines: ['Choose one response that describes your usual behavior at work.', 'I rarely feel comfortable asking colleagues for help.'],
    choices: ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'] },
  { id: 'behavioral-competing-deadlines', category: 'situational_judgment', incomplete: false,
    lines: ['Your task is due today. A colleague asks for help on another urgent task.', 'Choose the most constructive first response.'],
    choices: ['Stop your task immediately without discussing either deadline.', 'Explain your deadline and discuss priorities and available support.', 'Decline without asking about the request.'] },
  { id: 'behavioral-cropped-scale', category: 'personality', incomplete: true,
    lines: ['Choose ONE of the FIVE responses listed below.', 'I am comfortable adapting when plans change.'],
    choices: ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'] },
] as const
export type BehavioralLiveFixture = typeof BEHAVIORAL_LIVE_FIXTURES[number]
export const BEHAVIORAL_FIXTURE_HASH = createHash('sha256').update(JSON.stringify(BEHAVIORAL_LIVE_FIXTURES)).digest('hex')
const xml = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
export function behavioralFixtureSvg(fixture: BehavioralLiveFixture) {
  const height = fixture.incomplete ? 320 : 620
  const line = (s: string, y: number) => `<text x="42" y="${y}" font-size="23">${xml(s)}</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="${height}"><rect width="1100" height="${height}" fill="#fff"/><g fill="#172b4d" font-family="DejaVu Sans, sans-serif">${line('ORIGINAL PRACTICE QUESTION', 50)}${fixture.lines.map((s, i) => line(s, 110 + i * 40)).join('')}${fixture.choices.map((s, i) => line(`${'ABCDE'[i]}. ${s}`, 240 + i * 48)).join('')}</g></svg>`
}
export async function renderBehavioralFixture(fixture: BehavioralLiveFixture) {
  const require = createRequire(import.meta.url), fromNext = createRequire(require.resolve('next/package.json'))
  const sharp = fromNext('sharp') as (input: Buffer) => { png(): { toBuffer(): Promise<Buffer> } }
  const png = await sharp(Buffer.from(behavioralFixtureSvg(fixture))).png().toBuffer()
  return { png, sha256: createHash('sha256').update(png).digest('hex') }
}

/** Deterministic signals, not a semantic judge or employer scoring key. */
export function scoreBehavioralResponse(fixture: BehavioralLiveFixture, raw: unknown) {
  let observation: AptitudeObservation
  try { observation = parseAptitudeObservation(raw) } catch { return { schemaValid: false, formatAndBoundaryPassed: false, manualReviewRequired: true, checks: {} } }
  const advice = parseBehavioralAdvice(observation.message ?? '')
  const suggestion = advice?.suggestedResponse ?? ''
  const normalize = (s: string) => s.toLowerCase().replace(/[.,;:!?—–-]/g, ' ').replace(/\s+/g, ' ').trim()
  const referencesVisibleChoice = fixture.choices.some((option, index) => normalize(suggestion).includes(normalize(option))
    || new RegExp(`\\b(?:option|choice|response)\\s+${'ABCDE'[index]}\\b`, 'i').test(suggestion))
  const checks: Record<string, boolean> = {
    categoryMatches: observation.category === fixture.category,
    noPersonalAnswerInvented: observation.answer === null,
    statusMatches: observation.status === (fixture.incomplete ? 'needs_capture' : 'unsupported'),
    ...(fixture.incomplete ? { missingEvidenceIdentified: Boolean(observation.question?.missingEvidence.length) } : {
      threeSectionsPresent: advice !== null, referencesVisibleChoice,
      assessmentIntentIsTentative: /\b(?:may|might|could|possibly|likely|appears|suggests|unknown)\b/i.test(advice?.assessedBehavior ?? ''),
      ...(fixture.category === 'personality' ? { suggestionIsConditional: /\b(?:if|when|unless|provided|depends)\b/i.test(suggestion),
        noDirectPersonalAssertionDetected: !/\byou (?:are clearly|are definitely|always|never)\b/i.test(suggestion) } : {}),
    }),
  }
  return { schemaValid: true, formatAndBoundaryPassed: Object.values(checks).every(Boolean), manualReviewRequired: !fixture.incomplete, checks }
}
