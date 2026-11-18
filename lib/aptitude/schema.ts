/** Shared wire types. This module is safe to import from the browser. */
import { selectAptitudeComparison } from './comparison'

export const APTITUDE_CATEGORIES = [
  'numerical', 'data_interpretation', 'verbal', 'critical_reasoning', 'logical',
  'abstract', 'spatial', 'checking', 'situational_judgment', 'personality', 'unknown',
] as const
export type AptitudeCategory = typeof APTITUDE_CATEGORIES[number]
export type AptitudeCategorySelection = 'auto' | AptitudeCategory
export type AptitudeStrategy = 'single' | 'compare'
export const APTITUDE_CATEGORY_LABELS: Record<AptitudeCategory, string> = {
  numerical: 'Numerical reasoning', data_interpretation: 'Charts and tables',
  verbal: 'Verbal reasoning', critical_reasoning: 'Critical reasoning',
  logical: 'Logical reasoning', abstract: 'Abstract patterns', spatial: 'Spatial reasoning',
  checking: 'Checking and comparison', situational_judgment: 'Situational judgment',
  personality: 'Personality', unknown: 'Unclassified',
}

// Includes data-URL overhead; leaves headroom below hosted function body limits.
export const MAX_APTITUDE_IMAGE_CHARS = 3_500_000
export const MAX_APTITUDE_BODY_BYTES = MAX_APTITUDE_IMAGE_CHARS + 2_000
export type AptitudeRequest = {
  captureId: string
  questionVersion: number
  image: string
  category: AptitudeCategorySelection
  /** Absent means single; existing clients never opt into extra model calls. */
  strategy?: AptitudeStrategy
}
export type AptitudeQuestion = {
  stem: string
  instructions: string[]
  passage: string | null
  options: { id: string; label: string; text: string }[]
  responseType: 'single_choice' | 'multiple_choice' | 'free_response' | 'unknown'
  missingEvidence: string[]
}
export type AptitudeAnswer = {
  selectedOptionIds: string[]
  value: string | null
  unit: string | null
  summary: string
  workedExplanation: string[]
  evidence: string[]
  calculation: { expression: string; claimedValue: number; decimalPlaces: number | null } | null
}
export type AptitudeStatus = 'solved' | 'needs_capture' | 'ambiguous' | 'unsupported' | 'error'
export type AptitudeVerification = {
  method: 'arithmetic' | 'source_review' | 'none'
  outcome: 'passed' | 'disagreed' | 'not_run'
  notes: string[]
}
export type AptitudeObservation = {
  category: AptitudeCategory
  status: Exclude<AptitudeStatus, 'error'>
  question: AptitudeQuestion | null
  answer: AptitudeAnswer | null
  message: string | null
}
export type AptitudeComparisonDecision = 'agreement' | 'majority' | 'disagreement' | 'insufficient'
export type AptitudeComparisonCandidate = {
  /** Configured provider:model identity; model below is the actual returned identity. */
  modelId: string
  model: string | null
  provider: 'anthropic' | 'openai'
  status: 'complete' | 'failed' | 'timed_out'
  observation: AptitudeObservation | null
  verification: AptitudeVerification | null
  durationMs: number
  error: string | null
}
export type AptitudeComparison = {
  decision: AptitudeComparisonDecision
  selectedModelId: string | null
  agreementCount: number
  notes: string[]
  candidates: AptitudeComparisonCandidate[]
}
export type AptitudeResult = Omit<AptitudeObservation, 'status'> & {
  schemaVersion: 1
  captureId: string
  questionVersion: number
  questionId: string | null
  sourceHash: string
  status: AptitudeStatus
  verification: AptitudeVerification
  model: string | null
  provider: 'anthropic' | 'openai' | null
  durationMs: number
  comparison?: AptitudeComparison
}

export class AptitudeValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'AptitudeValidationError' }
}
const fail = (message: string): never => { throw new AptitudeValidationError(message) }
function object(value: unknown, name: string, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(`${name} must be an object`)
  const item = value as Record<string, unknown>
  if (Object.keys(item).some(key => !keys.includes(key)) || keys.some(key => !optional.includes(key) && !(key in item))) return fail(`${name} has unexpected or missing fields`)
  return item
}
function string(value: unknown, name: string, max = 8_000, nonempty = false): string {
  if (typeof value !== 'string' || value.length > max || (nonempty && !value.trim())) return fail(`Invalid ${name}`)
  return value
}
function nullableString(value: unknown, name: string, max = 8_000): string | null {
  return value === null ? null : string(value, name, max)
}
function strings(value: unknown, name: string, maxItems = 20, maxLength = 2_000): string[] {
  if (!Array.isArray(value) || value.length > maxItems) return fail(`Invalid ${name}`)
  return value.map(item => string(item, name, maxLength, true))
}
function member<T extends string>(value: unknown, values: readonly T[], name: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) return fail(`Invalid ${name}`)
  return value as T
}
function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail(`Invalid ${name}`)
  return value
}
function version(value: unknown): number {
  const n = finiteNumber(value, 'question version')
  if (!Number.isSafeInteger(n) || n < 0 || n > 2_147_483_647) return fail('Invalid question version')
  return n
}
function captureId(value: unknown): string {
  const id = string(value, 'capture ID', 128, true)
  if (!/^[A-Za-z0-9._:-]+$/.test(id)) return fail('Invalid capture ID')
  return id
}

export function parseAptitudeRequest(value: unknown): AptitudeRequest {
  const item = object(value, 'Request', ['captureId', 'questionVersion', 'image', 'category', 'strategy'], ['strategy'])
  const image = string(item.image, 'screenshot', MAX_APTITUDE_IMAGE_CHARS, true)
  if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) return fail('Provide a PNG, JPEG, or WebP screenshot')
  return { captureId: captureId(item.captureId), questionVersion: version(item.questionVersion), image,
    category: member(item.category, ['auto', ...APTITUDE_CATEGORIES], 'category'),
    ...('strategy' in item ? { strategy: member<AptitudeStrategy>(item.strategy, ['single', 'compare'], 'analysis strategy') } : {}) }
}

function parseQuestion(value: unknown): AptitudeQuestion | null {
  if (value === null) return null
  const item = object(value, 'Question', ['stem', 'instructions', 'passage', 'options', 'responseType', 'missingEvidence'])
  if (!Array.isArray(item.options) || item.options.length > 20) return fail('Invalid options')
  const options = item.options.map(value => {
    const opt = object(value, 'Option', ['id', 'label', 'text'])
    return { id: string(opt.id, 'option ID', 80, true), label: string(opt.label, 'option label', 80), text: string(opt.text, 'option text', 4_000, true) }
  })
  if (new Set(options.map(o => o.id)).size !== options.length) return fail('Option IDs must be unique')
  return { stem: string(item.stem, 'question stem', 12_000), instructions: strings(item.instructions, 'instructions'),
    passage: nullableString(item.passage, 'passage', 30_000), options,
    responseType: member(item.responseType, ['single_choice', 'multiple_choice', 'free_response', 'unknown'], 'response type'),
    missingEvidence: strings(item.missingEvidence, 'missing evidence') }
}
function parseAnswer(value: unknown): AptitudeAnswer | null {
  if (value === null) return null
  const item = object(value, 'Answer', ['selectedOptionIds', 'value', 'unit', 'summary', 'workedExplanation', 'evidence', 'calculation'])
  let calculation: AptitudeAnswer['calculation'] = null
  if (item.calculation !== null) {
    const calc = object(item.calculation, 'Calculation', ['expression', 'claimedValue', 'decimalPlaces'])
    const decimalPlaces = calc.decimalPlaces === null ? null : finiteNumber(calc.decimalPlaces, 'rounding')
    if (decimalPlaces !== null && (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 10)) return fail('Invalid rounding')
    calculation = { expression: string(calc.expression, 'expression', 512, true), claimedValue: finiteNumber(calc.claimedValue, 'calculated value'), decimalPlaces }
  }
  const selectedOptionIds = strings(item.selectedOptionIds, 'selected options', 20, 80)
  if (new Set(selectedOptionIds).size !== selectedOptionIds.length) return fail('Duplicate selected options')
  return { selectedOptionIds, value: nullableString(item.value, 'answer value', 500), unit: nullableString(item.unit, 'unit', 100),
    summary: string(item.summary, 'answer summary', 1_000, true), workedExplanation: strings(item.workedExplanation, 'worked explanation', 6, 2_000),
    evidence: strings(item.evidence, 'answer evidence', 12, 2_000), calculation }
}
function validateConsistency(observation: { category: AptitudeCategory; status: AptitudeStatus; question: AptitudeQuestion | null; answer: AptitudeAnswer | null; message: string | null }) {
  const { question, answer, status, category } = observation
  if (status !== 'solved') {
    if (answer !== null) return fail('An unfinished or unsupported question cannot publish an answer')
    if (!observation.message?.trim()) return fail('Explain why the question could not be answered')
    return
  }
  if (!question?.stem.trim() || !answer || question.missingEvidence.length || question.responseType === 'unknown') return fail('A solved question requires complete evidence and an answer')
  if (['unknown', 'personality', 'situational_judgment'].includes(category)) return fail('This question category has no supported objective answer')
  if (!answer.workedExplanation.length || !answer.evidence.length) return fail('An answer requires a worked explanation and visible evidence')
  const ids = new Set(question.options.map(option => option.id))
  if (answer.selectedOptionIds.some(id => !ids.has(id))) return fail('Selected option does not exist in the question')
  if (question.responseType === 'single_choice' && (question.options.length < 2 || answer.selectedOptionIds.length !== 1)) return fail('Select exactly one visible option')
  if (question.responseType === 'multiple_choice' && (question.options.length < 2 || !answer.selectedOptionIds.length)) return fail('Select visible options')
  if (question.responseType === 'free_response' && (answer.selectedOptionIds.length || !answer.value?.trim())) return fail('A free response requires a value and no selected options')
}

export function parseAptitudeObservation(value: unknown): AptitudeObservation {
  const item = object(value, 'Analysis', ['category', 'status', 'question', 'answer', 'message'])
  const result: AptitudeObservation = { category: member(item.category, APTITUDE_CATEGORIES, 'category'),
    status: member(item.status, ['solved', 'needs_capture', 'ambiguous', 'unsupported'], 'status'),
    question: parseQuestion(item.question), answer: parseAnswer(item.answer), message: nullableString(item.message, 'message', 1_000) }
  validateConsistency(result)
  return result
}

function parseVerification(value: unknown): AptitudeVerification {
  const check = object(value, 'Verification', ['method', 'outcome', 'notes'])
  return { method: member(check.method, ['arithmetic', 'source_review', 'none'], 'verification method'),
    outcome: member(check.outcome, ['passed', 'disagreed', 'not_run'], 'verification outcome'), notes: strings(check.notes, 'verification notes') }
}

export function parseAptitudeComparison(value: unknown): AptitudeComparison {
  const item = object(value, 'Comparison', ['decision', 'selectedModelId', 'agreementCount', 'notes', 'candidates'])
  if (!Array.isArray(item.candidates) || item.candidates.length < 2 || item.candidates.length > 3) return fail('Compare two or three distinct models')
  const candidates = item.candidates.map(value => {
    const candidate = object(value, 'Comparison candidate', ['modelId', 'model', 'provider', 'status', 'observation', 'verification', 'durationMs', 'error'])
    const provider = member<'anthropic' | 'openai'>(candidate.provider, ['anthropic', 'openai'], 'comparison provider')
    const modelId = string(candidate.modelId, 'comparison model ID', 200, true)
    if (!modelId.startsWith(`${provider}:`) || !/^(?:anthropic|openai):[A-Za-z0-9._-]+$/.test(modelId)) return fail('Invalid comparison model ID')
    const durationMs = finiteNumber(candidate.durationMs, 'comparison duration')
    if (durationMs < 0 || durationMs > 3_600_000) return fail('Invalid comparison duration')
    const parsed: AptitudeComparisonCandidate = { modelId, model: nullableString(candidate.model, 'comparison model', 200), provider,
      status: member(candidate.status, ['complete', 'failed', 'timed_out'], 'comparison candidate status'),
      observation: candidate.observation === null ? null : parseAptitudeObservation(candidate.observation),
      verification: candidate.verification === null ? null : parseVerification(candidate.verification), durationMs,
      error: nullableString(candidate.error, 'comparison error', 1_000) }
    if (parsed.status === 'complete') {
      if (!parsed.model?.trim() || !parsed.observation || !parsed.verification || parsed.error !== null) return fail('Invalid complete comparison candidate')
      if (parsed.observation.status === 'solved' && parsed.verification.outcome === 'disagreed') return fail('A disagreed calculation cannot vote')
    } else if (parsed.observation !== null || parsed.verification !== null || !parsed.error?.trim()) return fail('Invalid failed comparison candidate')
    return parsed
  })
  if (new Set(candidates.map(candidate => candidate.modelId)).size !== candidates.length) return fail('Comparison model IDs must be distinct')
  const agreementCount = finiteNumber(item.agreementCount, 'agreement count')
  if (!Number.isInteger(agreementCount) || agreementCount < 0 || agreementCount > candidates.length) return fail('Invalid agreement count')
  const comparison: AptitudeComparison = { decision: member(item.decision, ['agreement', 'majority', 'disagreement', 'insufficient'], 'comparison decision'),
    selectedModelId: nullableString(item.selectedModelId, 'selected comparison model', 200), agreementCount, notes: strings(item.notes, 'comparison notes'), candidates }
  const expected = selectAptitudeComparison(candidates).comparison
  if (comparison.decision !== expected.decision || comparison.selectedModelId !== expected.selectedModelId || comparison.agreementCount !== expected.agreementCount) return fail('Comparison decision is inconsistent with its candidates')
  return comparison
}

export function parseAptitudeResult(value: unknown): AptitudeResult {
  const keys = ['schemaVersion', 'captureId', 'questionVersion', 'questionId', 'sourceHash', 'category', 'status', 'question', 'answer', 'message', 'verification', 'model', 'provider', 'durationMs', 'comparison']
  const item = object(value, 'Aptitude result', keys, ['comparison'])
  if (item.schemaVersion !== 1) return fail('Unsupported result version')
  const sourceHash = string(item.sourceHash, 'source hash', 64)
  if (!/^[a-f0-9]{64}$/.test(sourceHash)) return fail('Invalid source hash')
  const questionId = nullableString(item.questionId, 'question ID', 64)
  if (questionId !== null && !/^[a-f0-9]{64}$/.test(questionId)) return fail('Invalid question ID')
  const durationMs = finiteNumber(item.durationMs, 'duration')
  if (durationMs < 0 || durationMs > 3_600_000) return fail('Invalid duration')
  const result: AptitudeResult = {
    schemaVersion: 1, captureId: captureId(item.captureId), questionVersion: version(item.questionVersion), questionId, sourceHash,
    category: member(item.category, APTITUDE_CATEGORIES, 'category'), status: member(item.status, ['solved', 'needs_capture', 'ambiguous', 'unsupported', 'error'], 'status'),
    question: parseQuestion(item.question), answer: parseAnswer(item.answer), message: nullableString(item.message, 'message', 1_000),
    verification: parseVerification(item.verification),
    model: nullableString(item.model, 'model', 200), provider: item.provider === null ? null : member<'anthropic' | 'openai'>(item.provider, ['anthropic', 'openai'], 'provider'), durationMs,
    ...('comparison' in item ? { comparison: parseAptitudeComparison(item.comparison) } : {}),
  }
  validateConsistency(result)
  if (result.status === 'solved' && (result.verification.outcome === 'disagreed' || !result.questionId || !result.model || !result.provider)) return fail('Invalid completed result')
  if (result.comparison) {
    const selected = result.comparison.candidates.find(candidate => candidate.modelId === result.comparison!.selectedModelId)
    if (selected) {
      if (result.status !== 'solved' || result.model !== selected.model || result.provider !== selected.provider || result.category !== selected.observation?.category ||
        JSON.stringify(result.question) !== JSON.stringify(selected.observation?.question) || JSON.stringify(result.answer) !== JSON.stringify(selected.observation?.answer) ||
        JSON.stringify(result.verification) !== JSON.stringify(selected.verification)) return fail('Selected comparison answer does not match its candidate')
    } else if (result.status === 'solved' || result.answer !== null) return fail('An unresolved comparison cannot publish an answer')
  }
  return result
}

const textSchema = { type: 'string' } as const
const nullableTextSchema = { type: ['string', 'null'] } as const
const list = (items: unknown) => ({ type: 'array', items })
const strictObject = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) })
const questionSchema = strictObject({
  stem: textSchema, instructions: list(textSchema), passage: nullableTextSchema,
  options: list(strictObject({ id: textSchema, label: textSchema, text: textSchema })),
  responseType: { type: 'string', enum: ['single_choice', 'multiple_choice', 'free_response', 'unknown'] }, missingEvidence: list(textSchema),
})
const answerSchema = strictObject({
  selectedOptionIds: list(textSchema), value: nullableTextSchema, unit: nullableTextSchema,
  summary: textSchema, workedExplanation: list(textSchema), evidence: list(textSchema),
  calculation: { anyOf: [strictObject({ expression: textSchema, claimedValue: { type: 'number' }, decimalPlaces: { type: ['integer', 'null'] } }), { type: 'null' }] },
})
/** Provider-side schema plus strict runtime/semantic validation above. */
export const APTITUDE_OBSERVATION_JSON_SCHEMA = strictObject({
  category: { type: 'string', enum: [...APTITUDE_CATEGORIES] },
  status: { type: 'string', enum: ['solved', 'needs_capture', 'ambiguous', 'unsupported'] },
  question: { anyOf: [questionSchema, { type: 'null' }] },
  answer: { anyOf: [answerSchema, { type: 'null' }] }, message: nullableTextSchema,
})
