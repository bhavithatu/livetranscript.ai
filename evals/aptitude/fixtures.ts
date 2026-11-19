import type { AptitudeCategory, AptitudeStatus } from '@/lib/aptitude/schema'
import { APTITUDE_VISUAL_FIXTURES } from './visualFixtures'

export type AptitudeFixtureDiagram = 'rotation' | 'count_pattern' | 'table' | 'star_points' | 'star_increments' | 'grid_rotation' | 'grid_xor' | 'spatial_ambiguous'
export type AptitudeEvidenceCheck = {
  id: string
  description: string
  /** Diagnostic rubric only. These patterns never enter the provider request. */
  allPatterns: string[]
  forbiddenPatterns?: string[]
  /** This original grid has a fixed source/choice inventory, scored only after the model returns. */
  gridRotationInventory?: boolean
}

export type AptitudeFixture = {
  id: string
  split: 'development' | 'held_out'
  view: { lines: string[]; diagram?: AptitudeFixtureDiagram; incomplete?: boolean; layout?: 'large_page' | 'cropped_choices' | 'obscured_diagram' }
  expected: { category: AptitudeCategory; status: AptitudeStatus; selectedLabels: string[]; criticalText: string[];
    /** Exact visible option text, when it is textual rather than a diagram description. */
    optionTextByLabel?: Record<string, string>;
    evidenceChecks?: AptitudeEvidenceCheck[];
    calculationValue?: number;
  }
}
/** Owned synthetic questions. Expected answers stay outside the image and provider prompt. */
export const APTITUDE_FIXTURES: readonly AptitudeFixture[] = [
  { id: 'percentage-original-base', split: 'development', view: { lines: ['A value rises from 80 to 100.', 'What is the percentage increase? Choose one.', 'A. 20%     B. 25%     C. 80%     D. 125%'] }, expected: { category: 'numerical', status: 'solved', selectedLabels: ['B'], criticalText: ['80', '100', 'increase'] } },
  { id: 'table-change', split: 'development', view: { lines: ['The table shows units sold.', 'Which store had the largest absolute increase?', 'A. North     B. South     C. East'], diagram: 'table' }, expected: { category: 'data_interpretation', status: 'solved', selectedLabels: ['C'], criticalText: ['absolute', 'North', 'South', 'East'] } },
  { id: 'passage-unknown', split: 'development', view: { lines: ['PASSAGE: All 18 Elm staff completed induction.', 'Six of those staff attended a workshop on Monday.', 'CLAIM: The other 12 attended the workshop on Tuesday.', 'Using the passage only, choose one.', 'A. True     B. False     C. Cannot say'] }, expected: { category: 'verbal', status: 'solved', selectedLabels: ['C'], criticalText: ['18', 'Six', 'Monday', 'Tuesday'] } },
  { id: 'ordering', split: 'development', view: { lines: ['Nia, Omar and Pia stand in one line.', 'Nia stands before Omar. Pia stands after Omar.', 'Who is in the middle? Choose one.', 'A. Nia     B. Omar     C. Pia'] }, expected: { category: 'logical', status: 'solved', selectedLabels: ['B'], criticalText: ['Nia', 'Omar', 'Pia', 'before', 'after'] } },
  { id: 'checking-zero', split: 'development', view: { lines: ['Choose the code that matches the reference EXACTLY.', 'Reference: A0l-7B2', 'A. AOl-7B2     B. A0l-7B2', 'C. A01-7B2     D. A0l-7BZ'] }, expected: { category: 'checking', status: 'solved', selectedLabels: ['B'], criticalText: ['A0l-7B2', 'AOl-7B2', 'A01-7B2', 'A0l-7BZ'] } },
  { id: 'necessary-assumption', split: 'held_out', view: { lines: ['A manager claims: replacing all old bulbs with efficient', 'bulbs will reduce this office\'s total electricity use.', 'Which assumption is necessary for that claim?', 'A. Electricity prices will fall.', 'B. The replacement will not cause an offsetting rise in use.', 'C. Staff prefer brighter lights.'] }, expected: { category: 'critical_reasoning', status: 'solved', selectedLabels: ['B'], criticalText: ['electricity', 'necessary', 'offsetting'] } },
  { id: 'pattern-count', split: 'held_out', view: { lines: ['Each box adds exactly one dot to the previous box.', 'Choose the next box in the sequence.'], diagram: 'count_pattern' }, expected: { category: 'abstract', status: 'solved', selectedLabels: ['B'], criticalText: ['one dot', 'next'] } },
  { id: 'spatial-quarter-turn', split: 'held_out', view: { lines: ['Rotate the source arrow 90 degrees clockwise.', 'Choose the resulting arrow.'], diagram: 'rotation' }, expected: { category: 'spatial', status: 'solved', selectedLabels: ['C'], criticalText: ['90', 'clockwise'] } },
  { id: 'missing-passage', split: 'held_out', view: { lines: ['The passage is above the visible screen area.', 'CLAIM: Every delivery arrived before noon.', 'Answer using ONLY that passage.', 'A. True     B. False     C. Cannot say'], incomplete: true }, expected: { category: 'verbal', status: 'needs_capture', selectedLabels: [], criticalText: ['passage'] } },
  { id: 'ambiguous-instruction', split: 'held_out', view: { lines: ['All the rules of this problem are shown here.', 'Start at 3. Apply EITHER ADD 2 OR MULTIPLY BY 2.', 'Both operations are permitted. No other rules apply.', 'Which SINGLE next value is uniquely determined?', 'A. 5     B. 6'] }, expected: { category: 'logical', status: 'ambiguous', selectedLabels: [], criticalText: ['ADD 2', 'MULTIPLY BY 2'] } },
  { id: 'personality-boundary', split: 'held_out', view: { lines: ['About you: I enjoy leading large groups.', 'Choose the response that best describes YOU.', 'A. Strongly disagree     B. Disagree', 'C. Neutral     D. Agree     E. Strongly agree'] }, expected: { category: 'personality', status: 'unsupported', selectedLabels: [], criticalText: [] } },
  { id: 'situational-boundary', split: 'held_out', view: { lines: ['At work a teammate misses an internal deadline.', 'Rank how you would respond to the situation.', 'A. Discuss the cause privately.', 'B. Escalate to the manager immediately.', 'C. Finish the work yourself without telling anyone.'] }, expected: { category: 'situational_judgment', status: 'unsupported', selectedLabels: [], criticalText: [] } },
  ...APTITUDE_VISUAL_FIXTURES,
]
