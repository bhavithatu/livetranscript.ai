# Aptitude evaluation

This is a runnable **12-question synthetic pilot**, not evidence of a model's real assessment accuracy. No live model results are committed. Offline tests verify the parser, scorer, rendered fixtures and safeguards; passing them does not measure AI accuracy or latency.

## What runs

The production `analyzeAptitude` path receives a real rendered PNG and `category: auto`. The default `single` strategy evaluates each explicitly selected model as a separate baseline. The optional `compare` strategy evaluates one joint arm containing exactly two or three explicitly selected models. Each candidate receives the same screenshot in its own structured multimodal request; the production deterministic selector decides which answer, if any, to display. Both evaluation strategies disable fallback and SDK retries and use the production overall 25-second analysis deadline. The answer key, fixture ID, split and expected category never enter the provider prompt or the selector.

The pilot covers numerical change, table interpretation, passage-only inference, critical reasoning, order constraints, a visual pattern, a spatial rotation, literal checking, a cropped passage, an ambiguous rule, personality and situational judgment. Five development items and seven held-out items are labeled separately. The visual diagrams and all text were authored for this repository. The small held-out split is for workflow rehearsal; expand it before using it for model selection.

## Run without provider calls

```sh
pnpm exec vitest run lib/aptitude/schema.test.ts lib/aptitude/calculator.test.ts lib/aptitude/analyze.test.ts app/api/aptitude/analyze/route.test.ts
pnpm exec vitest run --config evals/aptitude/vitest.config.ts
```

Prepare inspectable screenshots and a hash manifest (still no API calls):

```sh
APTITUDE_EVAL_PREPARE=1 pnpm exec vitest run --config evals/aptitude/vitest.config.ts prepareFixtures
```

Review `benchmark-results/aptitude-fixtures/*.png` and its `manifest.json`. The manifest binds screenshot bytes, fixture definitions including answer keys, prompt and JSON schema. Font/rasterizer differences change the hashes; inspect and prepare a new manifest if those change. Next's installed Sharp renders the SVG source to actual PNG bytes; SVG is never mislabeled as PNG.

## Explicit live run

Existing provider credentials must be configured in the server environment. This harness does not create credentials or print their values. Choose only models in `lib/aptitude/modelPolicy.ts` and set a positive call cap of at most 100. The runner validates credentials, models, manifest hashes and the full plan **before any call**. Omitting `APTITUDE_EVAL_STRATEGY` preserves the single-model baseline behavior.

```sh
APTITUDE_EVAL_LIVE=1 \
APTITUDE_EVAL_MODELS=openai:gpt-4.1 \
APTITUDE_EVAL_MAX_CALLS=12 \
APTITUDE_EVAL_REPEATS=1 \
APTITUDE_EVAL_MANIFEST=benchmark-results/aptitude-fixtures/manifest.json \
pnpm exec vitest run --config evals/aptitude/vitest.config.ts runBenchmark
```

To evaluate the two-model comparison arm on the same twelve screenshots, explicitly select comparison and budget all 24 candidate calls:

```sh
APTITUDE_EVAL_LIVE=1 \
APTITUDE_EVAL_STRATEGY=compare \
APTITUDE_EVAL_MODELS=openai:gpt-4.1,openai:gpt-4.1-mini \
APTITUDE_EVAL_MAX_CALLS=24 \
APTITUDE_EVAL_REPEATS=1 \
APTITUDE_EVAL_MANIFEST=benchmark-results/aptitude-fixtures/manifest.json \
pnpm exec vitest run --config evals/aptitude/vitest.config.ts runBenchmark
```

Run the same model list with `APTITUDE_EVAL_STRATEGY=single` and the same call budget to collect separate baselines. These are separate runs; comparison never quietly adds baseline calls. All selected candidates need configured provider credentials. Comparison uses `APTITUDE_COMPARISON_MODELS` internally, derived only from the explicitly supplied evaluation model list, and clears fallback configuration. A transport guard rejects unexpected candidates, repeated calls to one candidate within a question, and any call beyond the planned or explicit cap.

| Twelve fixtures, one repeat | Question attempts | Planned provider calls |
| --- | ---: | ---: |
| Single, one model | 12 | 12 |
| Single, two models | 24 | 24 |
| Compare, two models | 12 | 24 |
| Single, three models | 36 | 36 |
| Compare, three models | 12 | 36 |

The exact plan is `fixtures × distinct selected models × repeats` provider calls. Repeats are limited to three. For example, three models and three repeats require 108 calls, so the runner rejects that plan before any request because the maximum cap is 100. Failed starts still consume budget and are not retried. A rejected input or interrupted run may start fewer calls; actual starts are reported separately from the plan. No live invocation is enabled by the offline test commands.

The runner checkpoints each question attempt and every provider-call start/completion under `benchmark-results/aptitude-*/report.json`. Report version 2 separates `plannedAttempts` from `plannedCalls` and records strategy, requested/returned models, source hashes, full result, selected-answer and candidate scores, actual wall-clock duration, per-provider duration, available token counts, validation outcomes and errors. Missing token counts remain null. An attempt-level token total is populated only when every started call supplied that usage field; per-call values remain available when a total is unknown. No price or token values are invented. Calls that time out or are cancelled may still incur provider charges. Interrupted runs remain explicitly incomplete, with the active attempt marked aborted when the process permits checkpointing. A hard process kill can leave an attempt running; it is never promoted to a completed result.

Reports contain end-to-end correct counts, objective-answer counts, abstention/false-certainty counts, per-split p50/p95 duration and the full attempts. Attempted objective and boundary denominators come from fixture truth, so provider errors, malformed replies and cancellations cannot disappear just because there is no score. A failed request is neither a correct abstention nor a confident wrong answer. Reports include both false-certainty rates over attempted boundary items and over valid scored boundary items, along with failure counts; report them together. Selected option labels determine multiple-choice correctness after presentation-only trimming of whitespace, enclosing parentheses/square brackets and a trailing period (for example, `B`, `B.` and `(B)`). Option text and source evidence are never normalized. Schema validity and keyword coverage do not prove semantic correctness. Critical-text coverage is a limited diagnostic, not OCR accuracy. Human review must check copied quantities, table axes, negation, visual feature interpretation and evidence fidelity.

### What comparison scores establish

The joint arm is scored on the final answer actually selected for display. A correct dissenting candidate does not rescue an incorrect majority in `endToEndCorrect`. Candidate scores are retained for diagnosis, while agreement, majority, disagreement and insufficient-response counts describe the selector's behavior. `consensusWrongCount` records published agreement/majority answers that disagree with the fixture key. Offline tests deliberately include two models making the same wrong-denominator calculation: their arithmetic passes and their answers agree, but the comparison score is wrong. Another test preserves a correct minority answer while scoring the selected wrong majority as incorrect.

The selector compares complete literal question evidence and option mappings before considering matching answers. A tie, changed source evidence, or insufficient eligible answers withholds a selected answer. Two agreeing eligible answers can still be displayed when a third candidate failed or abstained; all candidate outcomes remain visible. Within a matching group, arithmetic verification and a deterministic model-ID order choose the displayed representative. This is corroboration, not evidence that the representative is the best model or that agreement is calibrated confidence.

Compare the joint arm with its separate baselines using the same reviewed manifest, model list and repeat count. Parallel candidate calls can reduce elapsed time relative to running those candidates sequentially, but they still consume each provider call and each call's tokens. The report measures joint wall-clock duration separately from provider durations; adding durations is not joint latency. Errors and timeout durations remain in the attempted-run latency distribution. No accuracy improvement, speed advantage, dollar cost or preferred model is established until live runs are performed and reviewed. Shared prompts, related models, and common image-reading mistakes can produce correlated errors even across providers.

## Capability policy and deployment configuration

`APTITUDE_MODEL` accepts an explicit `provider:model` entry from the allowlist. With no override the known image-capable default is Claude Sonnet 4.5 when an Anthropic key exists, otherwise GPT-4.1. `APTITUDE_FALLBACK_MODELS` is an optional comma-separated list of at most two additional allowlisted models, each with its own configured credential. An unknown model or missing credential produces a clear 503 response. A key alone does not establish image support. These defaults are unranked candidates, **not measured winners**.

The allowlist includes Claude Sonnet/Haiku 4.5 and GPT-4.1/4.1-mini. Capability references, checked 2026-11-18:

- [Claude models](https://platform.claude.com/docs/en/models/overview): image input.
- [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs): `output_config.format` JSON schema.
- [GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1) and [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini): image input and structured outputs.
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs): schema-constrained output and refusals.

The installed OpenAI and Anthropic SDK types were checked for the transport parameters. Runtime schema/option/evidence checks still run after provider output. The calculator only checks bounded arithmetic and comparable numeric answers; it does not validate transcription, formula choice, dimensional analysis or semantics. Non-numeric answers carry an explicit unverified note. The optional comparison strategy adds two or three parallel candidate calls and deterministic corroboration; it does not add an LLM judge, hidden retry, or independent semantic oracle. The single-model baseline remains available for measuring its actual tradeoffs.

## Before selecting a production model

Expand to a balanced, independently authored, reviewed held-out set for each category and difficulty. Include charts with units, multiple-select, rounding, ratio reversals, negation, rotated/reflected figures, partial captures, compression, tiny text and repeated layouts. Keep prompts and tuning fixtures separate from the held-out set. Compare cold/warm latency, failures, complete-question accuracy, false certainty on unreadable questions and cost using actual provider usage. Repeat and report uncertainty rather than ranking on this 12-item pilot. Capture change detection has separate deterministic tests; end-to-end time also includes image stabilization, upload and rendering, which this server runner does not measure.
