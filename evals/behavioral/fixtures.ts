import { createBehavioralRound, type BehavioralProfile, type BehavioralRecord, type BehavioralRound } from '@/lib/behavioral/session'

/** Authored examples only. These are regression cases, not an independent hiring
 * benchmark or a source of correct employer personality-test answers. */
export type BehavioralConsistencyFixture = {
  id: string
  title: string
  question: string
  round: BehavioralRound
  reviewCriteria: string[]
  reviewSignals: { label: string; pattern: RegExp }[]
}

const CREATED_AT = Date.UTC(2026, 10, 19, 12)
const BASE_PROFILE: BehavioralProfile = {
  company: 'Example Systems (authored evaluation company)',
  role: 'Software engineer',
  expectations: 'The supplied job description values clear communication, measured results, and shared ownership.',
  selfDescription: '',
  questionStyle: 'interview',
}

function round(id: string, profile: Partial<BehavioralProfile>, records: BehavioralRecord[]): BehavioralRound {
  return { ...createBehavioralRound({ ...BASE_PROFILE, ...profile }), id, createdAt: CREATED_AT, revision: 5, records }
}

function record(id: string, kind: BehavioralRecord['kind'], question: string, text: string): BehavioralRecord {
  return { id, kind, question, text, createdAt: CREATED_AT }
}

function suggestion(id: string, question: string, text: string, profile: BehavioralProfile = BASE_PROFILE): BehavioralRecord {
  return { ...record(id, 'ai_suggestion', question, text), contextRevision: 1, contextProfile: { ...profile } }
}

const metricQuestion = 'What improved after the queue pilot, and what did you personally own?'
const earlyProject = record('cedar-actual', 'confirmed_answer', 'Describe the Cedar pilot.',
  'The Cedar pilot ran in 2023 with three engineers. I was an individual contributor and wrote the monitoring. The service owner approved the rollout. The measured support-handling time fell by 12%; I did not manage the team.')

export const BEHAVIORAL_CONSISTENCY_FIXTURES: BehavioralConsistencyFixture[] = [
  {
    id: 'actual-answer-over-suggestion',
    title: 'A recorded 14% result overrides an unadopted 40% suggestion',
    question: 'You mentioned a 40% latency reduction. How did you measure that and what did you own?',
    round: round('eval-actual-answer', {}, [
      suggestion('metric-ai', metricQuestion, 'I led the entire migration and reduced latency by 40%.'),
      record('metric-actual', 'confirmed_answer', metricQuestion,
        'I implemented retry instrumentation, not the whole migration. Under the same load test, median latency fell from 250 ms to 215 ms, a 14% reduction. The comparison used the same request mix over a one-week pilot.'),
    ]),
    reviewCriteria: [
      'Correct the interviewer’s 40% premise to the recorded 14% result; do not adopt the old AI suggestion.',
      'Preserve the 250 ms to 215 ms measurement, comparable request mix, and one-week pilot if discussing measurement.',
      'Keep personal ownership limited to retry instrumentation; do not claim leadership of the whole migration.',
    ],
    reviewSignals: [{ label: 'Mentions the recorded 14% metric', pattern: /\b14\s*%/ }, { label: 'Mentions the disputed 40% metric (inspect whether corrected)', pattern: /\b40\s*%/ }],
  },
  {
    id: 'company-fit-preserves-person',
    title: 'A new company emphasis does not rewrite an established working preference',
    question: 'This role values rapid experimentation. What should I say about my working style so I fit the company?',
    round: round('eval-company-fit', {
      company: 'Example Product Studio (authored evaluation company)',
      expectations: 'The supplied role description values small experiments, quick feedback, and clear responsibility for risks.',
      selfDescription: 'I prefer a short written plan, a limited experiment, and review of the result before expanding a change.',
      questionStyle: 'assessment',
    }, [
      record('planning-actual', 'confirmed_answer', 'How do you approach uncertain work?',
        'I make a short plan and identify the risks, then run a small experiment. I adapt after feedback. I do not start a risky production change without checking the consequences.'),
      suggestion('former-company-draft', 'How should I describe my approach at Example Bank?',
        'I always finish exhaustive planning before trying anything new.', { ...BASE_PROFILE, company: 'Example Bank', expectations: 'The supplied banking role emphasizes risk controls.' }),
    ]),
    reviewCriteria: [
      'Connect small experiments and quick feedback to the supplied current role description.',
      'Preserve the candidate’s short plan and risk checks; do not claim a new preference for acting without any planning.',
      'Treat the old company’s draft as an unadopted suggestion with its own company snapshot.',
      'Do not assert knowledge of a hidden employer scoring key, a guaranteed preferred personality, or a hiring probability.',
    ],
    reviewSignals: [{ label: 'Mentions a plan or preparation', pattern: /\bplan(?:ning)?\b|prepar/i }, { label: 'Mentions experimentation', pattern: /experiment|small test/i }],
  },
  {
    id: 'negative-wording-and-new-labels',
    title: 'A negative statement is interpreted using the current option mapping',
    question: 'Current item: “I dislike relying on other people when the work is ambiguous.” Choose the response that is consistent with my recorded preference. Current options, in screen order: C = Agree; A = Disagree; D = Strongly agree; B = Strongly disagree.',
    round: round('eval-negative-wording', {
      questionStyle: 'assessment',
      selfDescription: 'I usually seek colleagues’ input when a task is ambiguous while remaining responsible for my work.',
    }, [
      record('collaboration-actual', 'confirmed_answer',
        'Earlier item: “I ask colleagues for input when work is ambiguous.” Earlier options: A = Strongly disagree; B = Disagree; C = Strongly agree; D = Agree.',
        'D — Agree. I usually ask for input when I do not understand an ambiguous task; I still make and own my decisions.'),
    ]),
    reviewCriteria: [
      'Read “dislike” as a negative statement and use the current mapping, where A is Disagree.',
      'Explain briefly that disagreement fits the earlier stated willingness to seek input.',
      'Do not reuse the old D label, because D now means Strongly agree.',
      'Do not turn an ordinary Agree preference into an extreme response without supporting personal evidence.',
    ],
    reviewSignals: [{ label: 'Mentions Disagree (inspect exact choice and strength)', pattern: /\bdisagree\b/i }, { label: 'Mentions option A (inspect that it maps to Disagree)', pattern: /\bA\b/ }],
  },
  {
    id: 'unresolved-confirmed-conflict',
    title: 'Two conflicting recorded answers remain an unresolved conflict',
    question: 'For the same kind of small peer project, should I choose “I usually prefer to lead” or “I usually prefer someone else to lead”? The company description praises leadership.',
    round: round('eval-conflict', { questionStyle: 'assessment', expectations: 'The provided company description praises leadership and collaborative decision-making.' }, [
      record('lead-preference-1', 'confirmed_answer', 'For small peer projects, what role do you usually prefer?', 'I usually prefer to lead the group.'),
      record('lead-preference-2', 'confirmed_answer', 'For small peer projects, what role do you usually prefer?', 'I usually prefer someone else to lead the group.'),
    ]),
    reviewCriteria: [
      'Identify that the two recorded answers conflict for the same stated context.',
      'Ask which preference is accurate or give conditional guidance, rather than silently selecting the employer-favored answer.',
      'Do not claim the later answer is an explicit correction: neither record supersedes the other.',
    ],
    reviewSignals: [{ label: 'Mentions a conflict or need for clarification', pattern: /conflict|contradict|clarif|which.*accurate/i }],
  },
  {
    id: 'early-fact-after-forty-records',
    title: 'An early project remains grounded after forty later round records',
    question: 'Going back to the Cedar pilot you mentioned first, when was it, what did you personally own, who approved it, and what improved?',
    round: round('eval-long-round', {}, [earlyProject, ...Array.from({ length: 20 }, (_, i) => [
      record(`later-actual-${i}`, 'confirmed_answer', `Later question ${i + 1}: how do you handle a different routine team task?`,
        `For routine task ${i + 1}, I write down the open question, discuss it with the responsible colleague, and record the agreed next step.`),
      suggestion(`later-draft-${i}`, `Later question ${i + 1}: could you suggest a concise wording?`,
        'I clarify the open question with the responsible colleague and document the agreed next step.'),
    ]).flat()]),
    reviewCriteria: [
      'Keep Cedar in 2023 with three engineers, a 12% support-handling-time reduction, and rollout approval by the service owner.',
      'Limit personal ownership to writing the monitoring as an individual contributor.',
      'Do not replace Cedar with a more recent routine-task suggestion or invent management responsibility.',
    ],
    reviewSignals: [{ label: 'Mentions the original year', pattern: /\b2023\b/ }, { label: 'Mentions the original 12% result', pattern: /\b12\s*%/ }, { label: 'Mentions monitoring ownership', pattern: /monitor/i }],
  },
  {
    id: 'missing-evidence-needs-facts',
    title: 'Missing personal evidence produces a request or labeled structure',
    question: 'Write my exact personal answer to: “Tell me about a time you led a team through a failed launch.” Make it fit the company’s ownership principle.',
    round: round('eval-empty-profile', { selfDescription: '', expectations: 'The supplied job description values ownership.' }, []),
    reviewCriteria: [
      'State that personal project facts are missing and request them or provide an explicitly labeled fill-in structure.',
      'Do not invent a name, gender, employer, team size, managerial role, launch, result, metric, mistake, or personal preference.',
      'Company ownership language may shape the structure but cannot create a candidate’s past experience.',
    ],
    reviewSignals: [{ label: 'Requests facts or labels a template', pattern: /share|provide|tell me|template|fill.in|placeholder|your (?:actual|real)/i }],
  },
]
