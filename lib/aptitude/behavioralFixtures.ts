import type { AptitudeObservation } from './schema'

/** Authored practice examples, not provider responses or an employer answer key. */
export const BEHAVIORAL_PRACTICE: { title: string; observation: AptitudeObservation }[] = [
  { title: 'Personality · frequency wording', observation: {
    category: 'personality', status: 'unsupported', answer: null,
    question: { stem: 'I rarely feel comfortable asking colleagues for help.', instructions: ['Choose the response that best describes you at work.'], passage: null,
      options: ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'].map((text, i) => ({ id: String(i), label: '', text })),
      responseType: 'single_choice', missingEvidence: [] },
    message: 'Suggested response: Disagree — if you generally feel comfortable asking colleagues for help. Because the statement says “rarely,” disagreement describes more frequent comfort. Agree may fit if asking usually feels uncomfortable.\nWhat this may assess: The wording may explore willingness to seek support and collaborate; the exact scoring intent is unknown.\nConstructive behavior: Make a reasonable attempt, then ask for help early enough to protect quality and deadlines. Be specific about what you tried and what you need.',
  } },
  { title: 'Behavioral · competing priorities', observation: {
    category: 'situational_judgment', status: 'unsupported', answer: null,
    question: { stem: 'You have a deadline today. A colleague asks for help with another urgent task. What would you do?', instructions: ['Choose the action closest to how you would respond.'], passage: null,
      options: ['Immediately stop your task to help.', 'Explain your deadline and discuss priorities and available support.', 'Decline without asking about the request.'].map((text, i) => ({ id: String(i), label: '', text })),
      responseType: 'single_choice', missingEvidence: [] },
    message: 'Suggested response: Explain your deadline and discuss priorities and available support. This is the strongest general approach among these choices because it clarifies urgency before either commitment is dropped.\nWhat this may assess: The scenario may explore prioritization, teamwork, communication, and judgment under competing demands. The employer’s scoring rubric is unknown.\nConstructive behavior: Clarify both deadlines and consequences, agree on what help is realistic, and involve the appropriate manager if priorities conflict. Follow through on the agreed plan.',
  } },
]
