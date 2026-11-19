# Aptitude model selection and benchmark evidence

## Current requested comparison — 2026-11-18 follow-up

The user explicitly requested one Claude and one OpenAI model after trying the
two-OpenAI configuration. The new default comparison is
`anthropic:claude-sonnet-5-5` plus `openai:gpt-6.2-sol`, both at high reasoning
effort. Single-model mode uses Sol when OpenAI is configured, or Sonnet when
only Anthropic is configured. Explicit server overrides still take precedence.

Both calls start concurrently, and each fully validated response can now reach
the client before its peer finishes. Each model has its own answer, response
time and uncalibrated confidence estimate. No combined confidence percentage
is invented, and source reconciliation remains separate from displaying an
individual answer. A disagreement does not hide either completed response.

The existing twelve original selection examples can be run as a bounded
**24-call regression** for this two-model pair. They are no longer an untouched
holdout. The runner now retains each schema-validated provider answer before
local verification, allowing a model error to be distinguished from a local
check that suppresses an answer. It never records provider thinking blocks or
the user's Safari questions. The historical pilot below is unchanged.

### Completed Claude/OpenAI regression

Commit `f2f47c19d2551886b84355470b83260f5e5593ca` completed all 24 calls on
Vercel deployment `dpl_6sMr14knPctoAPnJa4AxvTqukcaA`, with zero provider,
schema or source-image errors. [Full structured regression record](aptitude-claude-openai-regression-2026-11-18.json).

| Model | Clear questions correct | Boundaries correct | Incorrect proposals withheld |
| --- | ---: | ---: | ---: |
| Claude Sonnet 5.5 high | 8/10 | 2/2 | 2 |
| GPT-6.2 Sol high | 10/10 | 2/2 | 0 |

Claude's two withheld responses were actual errors, not checker false positives.
It selected 18.60 for a weighted average whose expression evaluates to 17.40
(confidence 99), and selected 21 when its own shape-value calculation yielded
22 (confidence 97). This is direct evidence that self-reported confidence is
not a calibrated probability. The arithmetic checks remain active.

Pairing the single-model runs for the ten clear questions gives a 5.38 s median
to the first usable answer and 7.11 s median until both finish; a usable answer
arrived earlier on eight of ten fixtures. These are server-side paired timings,
not measurements of the user's Safari workflow. In a separate live Cloud
Chromium check, the original percentage-increase practice question showed its
first answer at 4.591 s and both at 7.048 s. Both selected B, 25%; session export
contained the exact screenshot, both candidates, estimates and timings.

The separate eight-call release gate passed all six objective candidates and
both incomplete-capture boundaries, with no evidence flags or provider errors.
It withheld three combined selections because descriptions did not reconcile;
individual completed answers remained visible. This regression does not grade
the inaccessible forty-question Safari session or establish general accuracy.

Review date: **November 18, 2026**.

This record separates published benchmark evidence from this application's
original practice fixtures. Published results identify candidates to evaluate;
they do not measure this application's screenshot capture, answer mapping, or
time limit. The live migration pilot below has a complete 36-call result record.
No general aptitude-accuracy claim follows from this document.

## Candidate decision

Evaluate the following three models on the same twelve frozen, original
questions, with a maximum of **36 provider calls**:

| Model | Effort | Role in the pilot |
| --- | --- | --- |
| GPT-6.2 Astra | high | Strong visual-reasoning challenger, also supported by independent MMMU-Pro and ARC results |
| GPT-6.2 Sol | high | Near-tied visual-reasoning challenger with lower reported benchmark latency |
| Claude Sonnet 5.5 | high | Existing production baseline for a direct migration comparison |

This is a shortlist, not a claim that all three are the best models for every
question type. Choose the production configuration using measured correctness,
evidence quality, abstention behavior, and deadline success on the frozen pilot.
The two OpenAI candidates must not be assumed to make independent mistakes.

Claude Fable 5.2 is a strong later candidate. Its
[official model overview](https://platform.claude.com/docs/en/models/fable-5-2/overview)
documents image input and always-on adaptive thinking. The
[migration guide](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide)
states that Fable needs no access approval, but requires 30-day retention;
zero-retention workspaces need express authorization. Structured outputs are
unavailable for this model in organizations using customer-managed encryption
keys. The present pilot does not change retention settings or enable Fable.
Published capability does not establish this account's usable access.

## Published benchmark comparisons

### Roboflow Visual Reasoning

[Roboflow's task leaderboard](https://playground.roboflow.com/evals/visual-reasoning),
updated November 17, 2026, tests visual arithmetic, comparison, spatial relations,
deduction, and inference. Its examples include schedules and technical drawings;
it is not a dedicated employment-aptitude test. All rows below use **high** effort.

| Model | LLM-judged accuracy | Strict match | Inference time per sample |
| --- | --- | --- | --- |
| GPT-6.2 Sol | 93.6% | 90.3% | 6.41 s |
| GPT-6.2 Astra | 93.4% | 92.9% | 7.94 s |
| Gemini 4 Carbon | 92.3% | 92.3% | 52.28 s |
| Claude Fable 5.2 | 92.0% | 92.0% | 8.48 s |
| Claude Opus 5.5 | 85.9% | 85.9% | 9.12 s |
| Claude Sonnet 5.5 | 83.9% | 72.8% | 7.47 s |
| GPT-6 Sol | 77.7% | 77.3% | 7.37 s |

Sol's three-run accuracy range is 92.7–94.7%; Astra's is 92.7–94.0%.
Their 0.2-point difference does not establish a reliable winner.

The separate [methodology](https://playground.roboflow.com/evals) explains the
limits of these figures:

- Models receive the same samples; the current protocol averages three runs per
  effort tier. The displayed ± is half the min–max range, **not a confidence
  interval**.
- Gemini 3.5 Flash at temperature zero judges answers against the key. Strict
  match requires an exact normalized answer and penalizes added explanation.
  The strict/judge gap is largely an output-format issue; it is not an independent
  demonstration of better reasoning.
- Effort tiers map to different native provider settings. Inference time is not
  browser capture-to-answer time or a service-level guarantee.
- The inspected public pages did not disclose a named dataset or question count.
  The displayed model/configuration counts must not be presented as sample size.

Our structured response schema, image preprocessing, token cap, and deadline
differ from this benchmark, so its scores are candidate-selection evidence only.

### MMMU-Pro

[Artificial Analysis independently evaluates MMMU-Pro](https://artificialanalysis.ai/evaluations/mmmu-pro).
Its current page displays these **rounded** leading values:

| Model setting | Displayed score |
| --- | --- |
| GPT-6.2 Astra, max | 89% |
| Gemini 4 Carbon, medium | 89% |
| Gemini 4 Argon, medium | 88% |

The benchmark spans thirty academic disciplines. Its family includes a
vision-only format with question text embedded in an image, alongside other
formats. The cited evaluator's
[methodology](https://artificialanalysis.ai/methodology/intelligence-benchmarking)
specifies 1,730 questions, ten choices, one attempt, regex answer extraction,
and no tools. It does not explicitly identify that run as the vision-only
configuration. Do not describe this leaderboard as a direct test of this app's
screenshots, or give its rounded numbers invented decimal precision.

Astra's **max** result is not a measured result for our **high** profile. The
evaluation's token allowances and application deadline also differ. MMMU-Pro
supports the shortlist but cannot determine the production winner by itself.

### ARC-AGI: related abstract reasoning

ARC Prize's verified model pages report the following ARC-AGI-2 results:

| Model | Effort | ARC-AGI-2 score | Primary source |
| --- | --- | --- | --- |
| GPT-6.2 Astra | high | 94.6% | [ARC Prize](https://arcprize.org/results/openai-gpt-6-2-astra) |
| GPT-6.2 Astra | max | 95.8% | [ARC Prize](https://arcprize.org/results/openai-gpt-6-2-astra) |
| Claude Opus 5.5 | high | 93.3% | [ARC Prize](https://arcprize.org/results/anthropic-claude-opus-5-5) |
| Claude Sonnet 5.5 | high | 67.4% | [ARC Prize](https://arcprize.org/results/anthropic-claude-sonnet-5-5) |

ARC measures grid-rule abstraction under its own evaluation protocol. These
figures are related reasoning evidence, **not screenshot aptitude accuracy**.
They do not verify OCR, small diagram perception, option coordinates, or response
time in this application. Family-level GPT results must not be assigned to Sol
when the reported model is Astra. Scores from different effort settings are not
interchangeable.

## Question sources and answer-key access

The following primary sources are useful for a larger future evaluation. None
was run in full as part of the twelve-question migration pilot.

| Source | Relevant coverage and data | Answer-key access and limits |
| --- | --- | --- |
| [RAVEN original paper](https://openaccess.thecvf.com/content_CVPR_2019/papers/Zhang_RAVEN_A_Dataset_for_Relational_and_Analogical_Visual_REasoNing_CVPR_2019_paper.pdf) | 70,000 matrix problems across seven figure configurations, with structural and rule annotations. Simple grayscale figures emphasize relational reasoning. | The [author project](https://wellyzhang.github.io/project/raven.html) links downloads, and the [official repository](https://github.com/WellyZhang/RAVEN) provides a generator and benchmark code. Downloaded answer files were not inspected or validated in this review. Confirm split, labels, and permitted reuse before importing; the 2019 paper is not a current frontier-model ranking. |
| [MM-IQ project](https://acechq.github.io/MMIQ-benchmark/) | 2,710 items across eight reasoning paradigms, including logic, 2D/3D geometry, spatial relations, and counting. | The [author dataset](https://huggingface.co/datasets/huanqia/MM-IQ) exposes an `answer` column in its public test split. Its public leaderboard includes historical results such as o3 33.17%, Sonnet 3.7 Thinking 31.55%, and Gemini 2.5 Pro 31.23%; these are not results for the current candidates. |
| [MathVista project](https://mathvista.github.io/) | 6,141 examples from 31 datasets, including IQTest, FunctionQA, and PaperQA; arithmetic, geometry, charts, and logical reasoning. | The project documents a 1,000-example public development/validation subset, `testmini`, and a 5,141-example `test` split whose answer labels are withheld. A local keyed evaluation should use documented public labels; do not claim to have independently scored the private-key split. |
| [MathVision project](https://mathllm.github.io/mathvision/) | 3,040 competition mathematics questions across sixteen disciplines and five difficulty levels, with visual context. | The [author dataset](https://huggingface.co/datasets/MathLLMs/MathVision) exposes answer labels, but displayed `solution` fields can be null: an answer key is not necessarily a worked explanation. Its leaderboard includes both Python-assisted and no-tool runs; those protocols must remain separate. |

No comparable current RAVEN, MM-IQ, MathVista, or MathVision result was verified
for all three shortlisted models. This absence is an evidence gap, not a zero
score. The data sources above are options for a later controlled study, not
grounds for a universal model ranking.

Public examples can be familiar to a model or prompt author. Preserve an
untouched evaluation split and disclose any development use. Check each
dataset's own license and provenance before copying or redistributing images.
This work uses original practice questions and public research documentation;
it does not scrape live assessment pages or obtain private assessment keys.

## Frozen twelve-question migration pilot

The pilot uses **twelve newly authored practice screenshots**, each with an
expected answer or an explicit expected abstention. They are original app
fixtures, not a sample claimed to reproduce any benchmark above. Their rendered
images, answer keys, and scoring rules must be reviewed and frozen before live
inference. Models receive only the image and production prompt, never the key.
Fixture IDs and image hashes identify exactly what was evaluated.

Run Astra high, Sol high, and the Sonnet high baseline once per image, using the
same production schema and provider path. This permits at most 12 × 3 = 36
calls, with no retries or fallback expansion. Keep the 6,000-output-token cap
and the server's 25-second deadline explicit in the report. A timeout, refusal,
invalid response, or missing result remains in the denominator.

The frozen set contains ten answerable questions: inverse percentage, weighted
average, relative chart growth, passage scope, a necessary assumption, ordering,
multiple-select quantifiers, reflection followed by rotation, a grid combination,
and visual counting with two equations. Two further cases require abstention:
explicitly underdetermined operations and cropped spatial choices. It does not
cover every supported category or difficulty, such as literal character checking.
All twelve rendered images and their independent keys were reviewed before the
first provider call. The fixture-definition hash is
`243ac6d0d3f091493fdbf9045b597657660b7f497ede989ab42d6e99f40c9c7f`.

Record distinct outcomes:

1. **Answer correctness:** exact option/value against the authored key on
   answerable questions, including units and multiple-choice cardinality.
2. **Visual evidence:** whether the stem, numeric values, options, and relevant
   diagram cells/counts match what the fixture actually shows.
3. **Abstention behavior:** correct rejection of incomplete/ambiguous images,
   false abstentions on complete questions, and unsupported guesses.
4. **Contract and timing:** schema validity, provider failure, deadline success,
   measured latency, and actual model/effort identity.
5. **Comparison behavior:** this pilot deliberately tests individual models.
   Comparison selection is not evaluated by these 36 calls; the separate
   existing release check records combined selections and abstentions.

An arithmetic check only verifies the stated calculation. Matching model answers
do not establish that the screenshot was read correctly. A candidate that
abstains on every question must not receive a misleading perfect score.

Report raw counts with denominators and per-question outcomes. Twelve questions
can reveal regressions and inform a migration; they cannot establish broad
assessment accuracy or a stable P95 latency estimate. Repeated renderings of the
same underlying question are related cases, not independent evidence. A larger
untouched set is needed before making a general accuracy claim.

## Live pilot outcome

The pilot completed in production deployment `dpl_GbqBukVWPCeh1RnYiX9m1X2vUD1a`
from code revision `aeef352e7813103127c2dab026be4542c0e5937b`. All **36 planned
calls started and completed**. There were no provider errors, invalid schemas,
source-image mismatches, retries or timeouts. The exact prompt hash was
`73a65249e97f539e489d74029583126d9ea1624455befac31bbf4a20dcd9f46e`.

[Complete structured log export, 36 attempts and frozen image manifest](aptitude-selection-results-2026-11-18.json).
All candidate/score records and token totals were reconciled to the build
summary. The authenticated report endpoint was not downloaded; the linked file
explicitly identifies itself as an export from the structured build logs.

| Model, high effort | Correct objective answers | Correct boundary handling | Unnecessary final abstentions | Median response | Slowest observed |
| --- | --- | --- | --- | --- | --- |
| GPT-6.2 Astra | 10/10 | 2/2 | 0 | 7.35 s | 15.61 s |
| GPT-6.2 Sol | 10/10 | 2/2 | 0 | 6.86 s | 19.41 s |
| Claude Sonnet 5.5 | 7/10 | 2/2 | 3 | 3.97 s | 11.34 s |

Every model correctly transcribed the grid-combination inventory against the
authored coordinates. No supported evidence checks were flagged, but those
checks do not independently verify every observation or explanation. Durations
measure application analysis calls during this run, not browser capture time.
The sample is too small to claim a stable P95; the maximum is reported instead.

Sonnet's weighted-price, relative-chart and shape-value answers were withheld
by the application verifier. Raw schema diagnostics contain answer evidence and
worked steps, showing that Sonnet initially supplied a schema-valid solved
response. The frozen report does not retain its pre-verification answer,
calculation or exact verification notes. These are therefore **app-level
abstentions after verification**, not proven raw-model wrong answers. Neither
the prompt nor scoring rules were changed after seeing these results.

**Production decision:** use `openai:gpt-6.2-astra` for single-model analysis and
`openai:gpt-6.2-astra,openai:gpt-6.2-sol` for the optional comparison. Preserve
high effort, 6,000 output tokens, the 25-second deadline, and zero SDK retries.
The pilot does not establish an accuracy difference between Astra and Sol.
Astra is the quality-oriented choice supported by the independent benchmarks;
Sol supplies a capable, cheaper comparison. Related models can share mistakes.

At the standard uncached rates on the official
[Astra](https://developers.openai.com/api/docs/models/gpt-6.2-astra) and
[Sol](https://developers.openai.com/api/docs/models/gpt-6.2-sol) model pages,
Astra's input/output rates are $8/$40 per million tokens and Sol's are $2/$10.
Applying those rates to the recorded totals gives approximately $0.58 for
Astra's twelve calls and $0.16 for Sol's. These are uncached standard-rate
estimates, not billing records; cache behavior, tiers and image billing can
change the charge. Both models' observed accuracy was identical on this pilot.

The prior-model production regression gate also passed all six objective
candidate checks and two cropped-image checks after the prompt change. Its
strict comparison selector withheld all three combined objective selections;
passing individual candidates does not imply a combined answer was selected.
The first selected-model deployment, `dpl_HvpqZRpSagdH9sm2vipmSasf4YCr`, was
blocked despite all six objective answers and both boundary outcomes being
correct. The legacy star-evidence matcher accepted `4 points` but rejected
`4 outer points` and `four outer tips`. The complete evidence correctly counted
four, five and seven outer points. This is a confirmed wording-matcher false
positive, separate from model correctness. A narrow matcher correction and
positive/negative regression tests preserve the visual evidence requirement;
the gate is not disabled and the original failed deployment remains recorded.

The next selected-model deployment, `dpl_ETaHJJ8tDRt5zkFHJ5KmzDERp6j5`, also
returned six correct objective answers and two correct boundary outcomes, with
no provider failures. Astra's star evidence passed; Sol's equally correct
`four/five/seven outward points` descriptions exposed another unsupported
synonym. The matcher now accepts bounded outer/outward/outward-facing wording
while still rejecting wrong counts, counts of stars, and inward points. Exact
response regressions preserve both failed runs as evidence of checker defects;
neither failure is counted as a wrong model answer or removed from the record.

The corrected selected-model deployment must separately pass that gate and a
live app check before deployment verification is claimed. The one-time selection flag
was disabled after the pilot deployment captured its configuration, so future
builds do not repeat these 36 paid calls automatically.

These twelve cases have now informed model selection and are no longer an
untouched holdout. A larger separately authored set remains necessary before
claiming broad aptitude accuracy.

Related implementation records:
[Aptitude mode](aptitude-mode.md),
[verification](aptitude-verification.md),
[prompting](aptitude-prompting.md), and
[evaluation procedure](../evals/aptitude/README.md).
