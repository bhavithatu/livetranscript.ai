# Aptitude prompting

The production instructions live in `lib/aptitude/prompt.ts`. The provider call
supplies that system prompt, one captured image, a short question/category
request, and `APTITUDE_OBSERVATION_JSON_SCHEMA`. This document explains the
prompt design; it is not an extra prompt sent to providers.

## Reasoning and the visible explanation

The model must finish its analysis before emitting the structured answer. The
task contract is to read the source, represent its facts, apply the appropriate
method, test the proposed result against constraints and counterexamples, and
cross-check the final option. Its visible response contains a short worked
solution and observable evidence. It does not request hidden scratch work, a
transcript of every attempted thought, or a self-assigned confidence percentage.

This distinction follows current provider guidance:

- [OpenAI reasoning best practices](https://developers.openai.com/api/docs/guides/reasoning-best-practices)
  favors clear goals, constraints and output requirements. Reasoning models do
  not need a request to expose a step-by-step internal reasoning trace.
- [Claude Sonnet 5.5 prompting](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5-5)
  recommends adaptive thinking for reasoning tasks with structured JSON and
  permits a short answer explanation. Its effort setting and token budget
  should be evaluated together, because reasoning shares the output budget.

The shared prompt sets the task and acceptance criteria. Provider-specific
reasoning controls remain in the generation policy and transport. A higher
effort setting, a longer prompt, or a longer explanation is not evidence of
higher accuracy.

## Category strategies

| Category | Required approach | Common error addressed |
| --- | --- | --- |
| Numerical | Identify the requested quantity, use the stated units and denominator, calculate, then match the choice. | Reversed ratios, percent versus percentage-point confusion, wrong rounding. |
| Charts and tables | Read the exact row, column, axis, legend and period before calculating. | Combining different series or assuming an unshown baseline/value. |
| Verbal | Distinguish passage entailment, contradiction and insufficient evidence. | Treating an unstated claim as false or importing outside knowledge. |
| Critical reasoning | Identify premises and conclusion, then perform the requested inference, assumption or argument test. | Selecting a helpful statement instead of a necessary assumption. |
| Logical | Enforce every constraint; use valid arrangements and counterexamples to distinguish must/could/cannot. | Replacing “some” with “all” or possibility with necessity. |
| Abstract patterns | Inventory features, test suitable transformations against every applicable row/column, then match the predicted features. | Guessing from a convenient pair or a familiar puzzle template. |
| Spatial | Track landmarks, adjacency, orientation and occlusion under the stated transformation. | Confusing reflection and rotation or inventing hidden features. |
| Checking | Compare literal characters, positions, ordering and case. | Normalizing away a real difference. |

Personality, situational-judgment and interactive-game items retain the existing
unsupported outcome. The prompt does not invent a person's preferences or an
employer's scoring key. It does not silently turn Aptitude into an unrelated
general-purpose mode.

## Readability and uncertainty

Required printed content must be readable, including every answer choice. An
unstated pattern rule is something to infer; it is not automatically “missing
evidence.” If a question explicitly refers to instructions that are absent,
the model requests another capture.

`needs_capture` means required visual evidence is missing or unreadable.
`ambiguous` means the visible question admits materially plausible readings or
comparably simple supported rules that select different answers. The model
should not invent an arbitrary complex rule just to make every sequence
ambiguous. A passage's visible “Cannot say” choice can instead be a valid solved
answer.

## Output and verification boundaries

The revised prompt preserves the existing strict schema and option-ID rules.
Unlabeled options keep empty labels and stable screen-order IDs; numeric option
text is never promoted to a label. Evidence reports observations, while the
worked explanation reports the inferred method and result.

Regular grid matrices retain the typed cell inventory. Missing panels are
`null`, visible empty panels are `[]`, and all panels and options must map
completely within declared dimensions. Other relevant visible attributes still
belong in evidence; occupied-cell coordinates do not encode every possible
color, line or shape property.

Numeric calculations contain actual numeric literals, not placeholder
variables. The percentage example uses a rise from 120 to 150:
`(150-120)/120*100`, producing `25` with unit `%`. This illustrates the allowed
expression format and is not an answer supplied for any evaluation item.
Supported next-value sequence checks preserve only the observed values and the
declared rule; the predicted value is excluded from the input sequence.

Runtime validation can reject malformed fields, invented option references,
invalid arithmetic and contradictions between supported numeric results. It
cannot independently prove that the model read the image correctly, chose a
unique rule, or interpreted every sentence correctly. The comparison selector
also remains a separate mechanism: changing the prompt does not relax its
source-reconciliation requirements or guarantee a combined selection.

## Evaluation discipline

These are generic task strategies. No fresh evaluation answers or hidden answer
keys are included in the prompt. Evaluate a prompt/model combination on a
reviewed question set separate from tuning examples, tracking correct answers,
incorrect answers, appropriate abstention, unnecessary abstention, image-reading
errors, latency, and provider/schema failures separately. Offline parser and
browser tests establish software behavior; live model accuracy requires actual
provider runs. Public benchmark scores can shortlist candidates but do not
measure this application's screenshot workflow.
