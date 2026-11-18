# Aptitude evaluation

This is a runnable **12-question synthetic pilot**, not evidence of a model's real assessment accuracy. No live model results are committed. Offline tests verify the parser, scorer, rendered fixtures and safeguards; passing them does not measure AI accuracy or latency.

## What runs

The production `analyzeAptitude` path receives a real rendered PNG and `category: auto`. It extracts and solves in one structured multimodal request. Each live evaluation uses one explicitly selected model, no fallback, no SDK retries, and an overall 25-second analysis deadline. This makes the requested call cap exact. The answer key, fixture ID, split and expected category never enter the prompt.

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

Existing provider credentials must be configured in the server environment. This harness does not create credentials or print their values. Choose only models in `lib/aptitude/modelPolicy.ts` and set a positive call cap of at most 100. The runner validates credentials, models, manifest hashes and the full plan **before any call**.

```sh
APTITUDE_EVAL_LIVE=1 \
APTITUDE_EVAL_MODELS=openai:gpt-4.1 \
APTITUDE_EVAL_MAX_CALLS=12 \
APTITUDE_EVAL_REPEATS=1 \
APTITUDE_EVAL_MANIFEST=benchmark-results/aptitude-fixtures/manifest.json \
pnpm exec vitest run --config evals/aptitude/vitest.config.ts runBenchmark
```

The runner checkpoints each attempt under `benchmark-results/aptitude-*/report.json`, including requested/returned model, source hashes, result, exact-choice score, actual duration, available token counts and errors. Missing token counts remain null; no price or token values are invented. Calls that time out or are cancelled may still incur provider charges. Interrupted runs remain explicitly incomplete, with the active attempt marked aborted when the process permits checkpointing. A hard process kill can leave an attempt running; it is never promoted to a completed result.

Reports contain end-to-end correct counts, conditional objective-answer counts, abstention/false-certainty counts, per-split p50/p95 duration and the full attempts. Include provider errors in end-to-end denominators. Selected option labels determine multiple-choice correctness after presentation-only trimming of whitespace, enclosing parentheses/square brackets and a trailing period (for example, `B`, `B.` and `(B)`). Option text and source evidence are never normalized. Schema validity and keyword coverage do not prove semantic correctness. Critical-text coverage is a limited diagnostic, not OCR accuracy. Human review must check copied quantities, table axes, negation, visual feature interpretation and evidence fidelity.

## Capability policy and deployment configuration

`APTITUDE_MODEL` accepts an explicit `provider:model` entry from the allowlist. With no override the known image-capable default is Claude Sonnet 4.5 when an Anthropic key exists, otherwise GPT-4.1. `APTITUDE_FALLBACK_MODELS` is an optional comma-separated list of at most two additional allowlisted models, each with its own configured credential. An unknown model or missing credential produces a clear 503 response. A key alone does not establish image support. These defaults are unranked candidates, **not measured winners**.

The allowlist includes Claude Sonnet/Haiku 4.5 and GPT-4.1/4.1-mini. Capability references, checked 2026-11-18:

- [Claude models](https://platform.claude.com/docs/en/models/overview): image input.
- [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs): `output_config.format` JSON schema.
- [GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1) and [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini): image input and structured outputs.
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs): schema-constrained output and refusals.

The installed OpenAI and Anthropic SDK types were checked for the transport parameters. Runtime schema/option/evidence checks still run after provider output. The calculator only checks bounded arithmetic and comparable numeric answers; it does not validate transcription, formula choice, dimensional analysis or semantics. Non-numeric answers carry an explicit unverified note. Independent model verification is not enabled: a second call adds latency/cost and correlated model errors remain possible. Evaluate it as a separate arm before enabling it.

## Before selecting a production model

Expand to a balanced, independently authored, reviewed held-out set for each category and difficulty. Include charts with units, multiple-select, rounding, ratio reversals, negation, rotated/reflected figures, partial captures, compression, tiny text and repeated layouts. Keep prompts and tuning fixtures separate from the held-out set. Compare cold/warm latency, failures, complete-question accuracy, false certainty on unreadable questions and cost using actual provider usage. Repeat and report uncertainty rather than ranking on this 12-item pilot. Capture change detection has separate deterministic tests; end-to-end time also includes image stabilization, upload and rendering, which this server runner does not measure.
