import type { AptitudeFixture } from './fixtures'

const outwardPointModifier = '(?:(?:outer|outward(?:[ -]+facing)?)[ -]+)?'
const starPoints = {
  category: 'abstract', status: 'solved', selectedLabels: ['C'], criticalText: ['28', '35'],
  optionTextByLabel: { A: '42', B: '45', C: '49', D: '56' }, calculationValue: 49,
  evidenceChecks: [{
    id: 'counts-points-not-stars', description: 'Counts four, five and seven points on three separate stars.',
    // Outer/outward-facing tips and "4-pointed" describe the same count. Keep complete
    // number/noun tokens so larger counts or unrelated words cannot satisfy it.
    allPatterns: ['4|four', '5|five', '7|seven'].map(count => `\\b(?:${count})[ -]*${outwardPointModifier}(?:points?|pointed|tips?)\\b`),
    forbiddenPatterns: [
      '\\b(?:four|4|five|5|seven|7)[ -]+stars\\b',
      `\\b(?:star|shape)\\s+(?:has|shows|with)\\s+(?:6|six)[ -]*${outwardPointModifier}(?:points?|tips?)\\b`,
      `\\b(?:star|shape)\\s+is\\s+a\\s+(?:6|six)[ -]*${outwardPointModifier}(?:point|pointed|tip|tipped)[ -]+star\\b`,
    ],
  }],
} satisfies AptitudeFixture['expected']
const starLines = ['Each star follows the same number rule.', 'What number belongs below the last star? Choose one.']

/** Original diagrams, including layout stress cases. No user screenshots or answer-key text are rendered. */
export const APTITUDE_VISUAL_FIXTURES: readonly AptitudeFixture[] = [
  { id: 'visual-star-points', split: 'development', view: { lines: starLines, diagram: 'star_points' }, expected: starPoints },
  // This is a paired layout stress case, not an independent held-out question.
  { id: 'visual-star-points-large-page', split: 'development', view: { lines: starLines, diagram: 'star_points', layout: 'large_page' }, expected: starPoints },
  { id: 'visual-star-increasing-differences', split: 'development',
    view: { lines: ['The numbers follow a pattern clockwise around the star.', 'Which value replaces the question mark? Choose one.'], diagram: 'star_increments' },
    expected: { category: 'abstract', status: 'solved', selectedLabels: ['B'], criticalText: ['8', '12', '18', '26'],
      optionTextByLabel: { A: '34', B: '36', C: '38', D: '32' }, calculationValue: 36,
      evidenceChecks: [{ id: 'next-increment-ten', description: 'Recognizes successive differences 4, 6, 8 and next difference 10.',
        allPatterns: ['(?:\\+\\s*4|difference[^.]*4|\\bdiffers?\\s+by\\b[^.]*\\b4\\b|increase[^.]*4|increments?[^.]*4)', '(?:\\+\\s*6|difference[^.]*6|\\bdiffers?\\s+by\\b[^.]*\\b6\\b|increase[^.]*6|increments?[^.]*6)', '(?:\\+\\s*8|difference[^.]*8|\\bdiffers?\\s+by\\b[^.]*\\b8\\b|increase[^.]*8|increments?[^.]*8)', '(?:26\\s*\\+\\s*10|10\\s*\\+\\s*26|next[^.]*10|increment[^.]*10)'],
        forbiddenPatterns: ['26\\s*\\+\\s*8\\s*=\\s*34'] }],
    } },
  { id: 'visual-grid-quarter-turns', split: 'held_out',
    view: { lines: ['The filled squares follow a pattern across each row.', 'Choose the panel that completes the bottom-right position.'], diagram: 'grid_rotation' },
    expected: { category: 'abstract', status: 'solved', selectedLabels: ['D'], criticalText: ['bottom-right'], requireGridInventory: true,
      evidenceChecks: [{ id: 'three-squares-rotate', description: 'Checks every source panel, the missing position, and every option against the literal grid inventory.',
        gridRotationInventory: true,
        allPatterns: ['(?:3|three)[ -]*(?:filled |green |colored |coloured )?squares', '(?:clockwise|quarter[ -]turn|90)'],
        forbiddenPatterns: ['(?:adds? (?:one|1)|one more square|number of squares increases)'] }],
    } },
  { id: 'visual-grid-exclusive-or', split: 'held_out',
    view: { lines: ['In each row, panel 3 keeps squares filled in exactly ONE', 'of panels 1 and 2. Squares filled in both are removed.', 'Choose the missing bottom-right panel.'], diagram: 'grid_xor' },
    expected: { category: 'abstract', status: 'solved', selectedLabels: ['A'], criticalText: ['exactly', 'both'],
      evidenceChecks: [{ id: 'shared-center-removed', description: 'Removes the shared center square instead of taking the union.',
        allPatterns: ['(?:center|centre|middle)[^.]{0,100}(?:remov|empty|cancel|both)|(?:remov|cancel)[^.]{0,100}(?:center|centre|middle)'] }],
    } },
  { id: 'visual-grid-cropped-choices', split: 'development',
    view: { lines: ['The filled squares follow a pattern across each row.', 'Choose the panel that completes the bottom-right position.'], diagram: 'grid_rotation', layout: 'cropped_choices' },
    expected: { category: 'abstract', status: 'needs_capture', selectedLabels: [], criticalText: [] } },
  { id: 'visual-obscured-star-values', split: 'development',
    view: { lines: ['The numbers follow a pattern clockwise around the star.', 'Which value replaces the question mark? Choose one.'], diagram: 'star_increments', layout: 'obscured_diagram' },
    expected: { category: 'abstract', status: 'needs_capture', selectedLabels: [], criticalText: [] } },
  { id: 'visual-two-permitted-transformations', split: 'held_out',
    view: { lines: ['Apply EITHER a left-right reflection OR a 180-degree turn.', 'Both transformations are allowed. There are no other rules.', 'Which SINGLE next panel is uniquely determined?'], diagram: 'spatial_ambiguous' },
    expected: { category: 'spatial', status: 'ambiguous', selectedLabels: [], criticalText: ['EITHER', 'Both'] } },
]
