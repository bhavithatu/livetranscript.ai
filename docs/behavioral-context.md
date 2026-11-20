# Behavioral context and consistency

Behavioral mode now has an explicit round record. Its purpose is to preserve the candidate’s supplied facts, working preferences, recorded answers, and corrections across successive questions. A company’s supplied role description can guide which genuine experience or preference is most relevant. It is not an employer answer key and does not establish an ideal personality or a hiring probability.

## Evidence that reaches the next question

The round distinguishes user-recorded answers, explicit corrections, candidate notes, quoted source context, and AI suggestions. Generated text is not automatically marked as something the candidate said, selected, or submitted. A user-recorded answer means the user explicitly recorded it in LiveTranscript; the app does not thereby verify an external assessment submission.

Both manual questions and automatically captured interview questions use an immutable request-time snapshot of the shared Behavioral round. Profile changes and new user evidence advance the context revision. Completed AI suggestions retain their original company/profile snapshot and revision, so an older result is not relabeled as having been generated under a newer company profile. In-flight work must not publish against a superseded user context. A transport retry retains the original request snapshot.

The current question controls its wording, negation, and answer-option mapping. A previous option letter cannot be reused when the current choices are shuffled. Original personal facts, dates, metrics, and ownership remain source-grounded; a follow-up may reuse the same source story. Story retrieval no longer consumes a source merely because preparation began.

Background, voice context, and individual stories are transmitted as complete labeled source blocks. Deduplication compares a whole source’s label and text, so two stories that contain an identical outcome paragraph retain their separate associations. Mixed-speaker transcripts remain quoted source material; they are not automatically confirmed candidate answers.

An explicit correction identifies the earlier record it supersedes. Unresolved conflicts between two user statements remain visible to the model and call for clarification or conditional guidance. Company preferences do not silently resolve such a conflict.

## Coverage and storage boundaries

The source archive is bounded to 500 records and 2,000,000 encoded bytes per round. Ordinary record text is bounded to 32,000 characters; quoted source-context records may contain up to 120,000 characters. Questions are bounded to 2,000 characters. Company and role fields each allow 200 characters; supplied expectations and working-style fields each allow 8,000 characters.

A request snapshot is bounded to 180,000 serialized characters. Within that limit, it carries the complete retained round. If reduction is needed, only whole AI suggestions may be omitted, with exact omitted identifiers and coverage counts. User-authored answers, notes, corrections, and original source context remain verbatim. If those required sources alone exceed the request limit, generation stops with an explicit error instead of silently dropping earlier evidence. Export the round and start a new one when the limit is reached.

When an account identifier is supplied, the round is stored in that account’s session-storage namespace for the current browser tab. Other surfaces can keep a round in memory without persistent account storage. Browser storage can fail or be cleared, so the UI must surface save failures and provide export. The round is not a server-side backup, and different browser tabs or accounts do not share its answers implicitly.

Starting a new Behavioral round clears its recorded answers and suggestions, cancels pending answers, and retains the company/work-style profile and saved source documents. Other modes’ answer history is retained. The transcript boundary admits exact new continuations after the reset, including a rolling audio window. If ASR changes prevent a reliable boundary match, the uncertain text is excluded with a visible notice; the app does not guess that old speech belongs to the new round.

## Using the controls

Open `/copilot?mode=behavioral`, expand **Company, role and your work style**, and save the company, role, supplied expectations, genuine working preferences, and question type. The available types are Behavioral interview and Personality or situational judgment. For a personality item, paste its full wording and current response options.

After answering, use **Record my answer** and enter the words or option text actually used. **Use suggested text to edit** is an explicit editing convenience; saving the actual-answer form is still required to record the user’s report. An open draft stays attached to its original question if automatic detection advances.

**Round history and controls** separates user answers, corrections, source evidence, and unconfirmed AI suggestions. **Correct this** preserves the earlier record and attaches the correction to it. **Export round** saves the retained source data and provenance as JSON. **New behavioral round** starts fresh answer history while retaining the profile. Neither recording nor export selects or submits an answer on another site.

## Answer contract

For interviews, give a concise answer grounded in the relevant supplied experience, preserving follow-up facts and personal ownership. Do not invent a name, gender, team size, managerial role, achievement, mistake, metric, or experience. A missing story calls for real facts or an explicitly labeled structure.

For personality and situational-judgment questions, interpret the current wording and choices, relate them to the candidate’s supplied preferences and recorded answers, and explain relevant consistency briefly. Company fit can shape truthful emphasis. It cannot turn a suggested persona into confirmed personal evidence. Guidance remains subjective; it is not presented as an objectively verified personality answer, a known employer scoring key, or a calibrated success score.

## Verification

Deterministic tests cover source attribution, shared request snapshots, deep round history, explicit corrections, bounded payloads, stale-result rejection, and storage boundaries. They prove what data the application retains and transmits. They do not establish that a model will never contradict itself.

The new authored semantic corpus contains six cases:

| Case | Required behavior |
| --- | --- |
| Recorded 14% result versus AI’s earlier 40% draft | Correct the premise and preserve the actual measurement and ownership. |
| New company emphasis | Tailor relevance while preserving the candidate’s genuine working preference. |
| Negative wording and shuffled option labels | Interpret the negation and use current option text and labels. |
| Two conflicting recorded answers | Surface the conflict without silently choosing the employer-favored answer. |
| Early project after forty later records | Preserve the original date, team context, ownership, and outcome. |
| Missing personal facts | Ask for actual evidence or supply a labeled structure without fabrication. |

Run the offline contracts without contacting a provider:

```sh
npx vitest run evals/behavioral/evaluation.test.ts
```

The legacy `npm run eval:voice` command now aliases the new source-grounded continuity checks and opt-in semantic runner. It no longer uses the old context-free first-person voice heuristic. To include report-chunk reconstruction tests, run `npx vitest run --config evals/behavioral/vitest.config.ts` without enabling live calls.

### Local browser workflow check

With a local development server running in the repository’s `PREVIEW_NO_AUTH=1` preview mode, run:

```sh
BEHAVIORAL_QA_URL=http://127.0.0.1:3002 python3 qa/behavioral/verify.py
```

The harness accepts only an explicit localhost or `127.0.0.1` HTTP address with a port. It uses Python Playwright 1.55.0 and supports `CHROMIUM_PATH` when an existing Chromium executable is needed. It operates the real app forms, but answer and classifier responses are authored browser interceptions. A separate local diagnostics fixture validates only bounded app start/stop metadata and returns the matching count receipt; error/stall events, other stages, unexpected metadata and other browser API calls fail. Validated lifecycle batches are retained in the browser report. It therefore checks the product flow without making paid model calls.

The scenarios cover company/profile/source inputs, an AI 40% draft kept separate from the user’s actual 14% answer, history beyond four Q&A pairs, explicit correction, same-tab account-scoped reload, export provenance, and a new round that retains the profile. Layout captures cover 390, 768, and 1,280 pixels. Outputs are `qa-results/behavioral/browser-report.json`, `behavioral-{width}.png`, and `behavioral-round-export.json`. This Chromium check does not establish Safari/window-capture behavior or semantic model accuracy; report those checks separately if performed.

### Opt-in model regression

The semantic runner is opt-in. Select one explicit provider/model and a total call budget of at most six before running it. An optional case list can select a smaller subset. It uses the production Behavioral prompt, evidence renderer, model posture, token budget, and provider implementation. The direct transport has no speculative draft, fallback, or SDK retry, so each selected case starts at most one provider call. Calls that fail remain in the denominator and fail the transport run.

```sh
BEHAVIORAL_EVAL_RUN=1 \
BEHAVIORAL_EVAL_MODEL='anthropic:<configured-model-id>' \
BEHAVIORAL_EVAL_MAX_CALLS=6 \
BEHAVIORAL_EVAL_REPORT_PATH=/absolute/path/to/new-report.json \
npx vitest run --config evals/behavioral/vitest.config.ts runConsistency
```

Replace the model placeholder with an exact configured model ID; configure credentials through the normal secret mechanism, never in a command or report. The report path is optional and must be a new file; the runner refuses to overwrite an existing artifact. The default corpus contains six distinct cases and does not repeat calls. To run one case, for example, set `BEHAVIORAL_EVAL_CASES=actual-answer-over-suggestion` and `BEHAVIORAL_EVAL_MAX_CALLS=1`.

The report includes the exact authored evidence, questions, responses, latency, failures, and per-case review criteria. Simple presence signals are only reading aids: seeing both “14%” and “40%” does not establish that the model corrected the false premise. Every row starts with semantic review marked `pending`, and the report has no semantic pass rate until a separate review is performed. This corpus is an authored regression set, not an independent benchmark or an audit of the user’s historical assessment session.

During a deployment build, `sourceCommit` contains the validated full `VERCEL_GIT_COMMIT_SHA` when available. Console output uses compact JSON split into numbered `[behavioral-consistency-eval] [part N/T] ...` events, each no larger than 2,000 UTF-8 bytes. To reconstruct a report, retrieve the deployment’s report events, verify that every part from 1 through T is present exactly once, sort by part number, concatenate the text after each marker, and parse the resulting JSON. If any part is missing or conflicting, the report is incomplete and must not be treated as a verified result. The optional report file remains complete, formatted JSON; no report is published to a public route.

### Recorded model run, November 19, 2026

The initial production-build regression used the configured Behavioral primary, `anthropic:claude-sonnet-5`, with exactly six direct calls against commit `5390d5e134189f902ba6ad345af067a1fb09a730`. All six completed without provider or stream failure. Assistant review against the authored source criteria found five passing cases and one failure: the reverse-worded personality item escalated an ordinary Agree preference into Strongly disagree without supporting personal evidence.

The complete questions, source snapshots, responses, timings and review are retained in `docs/behavioral-consistency-regression-2026-11-19.json`. This is a small authored regression, not an independent accuracy estimate or a review of the user's assessment answers. The failure led to an explicit instruction to preserve response strength and frequency. The initial failure remains in the report.

A separately declared one-call rerun of that case used the revised prompt at commit `af29da7742b157795a05ec9154c7d4dc09d0a39b`. It completed in 2,641 ms and chose A, ordinary Disagree, explicitly explaining why Strongly disagree would overstate the earlier preference. Assistant review found the targeted response grounded and consistent with the supplied evidence. Its complete source and response are retained in `docs/behavioral-consistency-targeted-2026-11-19.json`. Seven total Behavioral calls were made across the initial run and targeted rerun; the other five scenarios were not rerun after this prompt change. These timings cover direct provider completion, not the complete browser interaction.
