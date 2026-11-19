# OpenAI API Migration Decision Ledger

**Application:** LiveTranscript Aptitude
**Current integration:** Direct OpenAI Chat Completions and Anthropic Messages, one high-detail screenshot per request, strict JSON plus runtime validation.
**Selected integration and model:** Retain direct SDK routes; add GPT6.2 Astra and GPT6.2 Sol high-effort profiles, evaluate against current Claude Sonnet5.5.
**Approved migration scope and feature-stage plan:** User authorized research, model/prompt upgrades, tests and deployment. Stage1: primary-source research and frozen prompt/fixtures. Stage2: local contract validation. Stage3: 36-call selection pilot using existing production credentials. Stage4: select production overrides, deploy and verify. Stages1–3 complete. All36calls completed; Astra/Sol each10/10objective and2/2boundaries. Selected Astra high primary and Sol high comparison; final selected-model deployment pending verification.
**Privacy and retention requirements:** Preserve existing account configuration and credential scope. No new provider or retention policy, no user photos in evaluation, no claims of ZDR or regional processing.
**Assessment or implementation:** Implementation in authorized repository; snapshot reviewed November18,2026.

Review every item against the application, selected model and provider, developer decisions, and approved scope. Add rows for newly documented capabilities or workload-specific differences; under the migration section, use one row per required workflow or invocation mode, even when sharing a provider, with its selected route, retained alternatives, code/documentation changes, and validation commands/results. Replace every placeholder with a concise, developer-visible decision; never claim a capability was implemented or tested without supporting evidence.

**Applicable:** Whether the capability benefits the application's behavior, workloads, or product requirements: `yes`, `no`, or `unknown`; support alone does not establish applicability.
**Supported:** Whether the selected model, provider, framework, and SDK can provide the capability: `yes`, `no`, `partial`, or `unknown`.
**Decision:** The capability's agreed migration outcome: `pending`, `implemented`, `already present`, `deferred`, `unsupported`, or `not applicable`. Use `deferred` only for a feature-specific developer decision or concrete blocker; justify `unsupported` or `not applicable` with capability or workload evidence.
**Implemented:** Mark `[x]` only after approved implementation is complete and verified; leave `[ ]` for pending, deferred, unsupported, or inapplicable items.
**Rationale or evidence:** The brief product, compatibility, privacy, cost, or scope justification; include the planned stage and developer-decision receipt, or relevant code, tests, and versioned official documentation.

## Model Selection

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Record a concrete supported model recommendation and suitability for each workload; models may be shared. | yes | yes | implemented | [x] | Astra6.2 high and Sol6.2 high are explicit challengers; Sonnet5.5 high is the baseline. User authorized best-model implementation. Freeze twelve original fixtures, run exactly 36 independent calls, then select from quality, latency and cost. See docs/aptitude-model-selection.md. The production decision after results is Astra6.2 high primary, Astra6.2/Sol6.2 high comparison; actual deployment is tracked separately. |
| Preserve an appropriate existing model; confirm material model or capability-tier changes. | yes | yes | implemented | [x] | Astra6.2 high and Sol6.2 high are explicit challengers; Sonnet5.5 high is the baseline. User authorized best-model implementation. Freeze twelve original fixtures, run exactly 36 independent calls, then select from quality, latency and cost. See docs/aptitude-model-selection.md. The production decision after results is Astra6.2 high primary, Astra6.2/Sol6.2 high comparison; actual deployment is tracked separately. |
| Account for workload quality, speed, latency, and cost. | yes | yes | implemented | [x] | Astra6.2 high and Sol6.2 high are explicit challengers; Sonnet5.5 high is the baseline. User authorized best-model implementation. Freeze twelve original fixtures, run exactly 36 independent calls, then select from quality, latency and cost. See docs/aptitude-model-selection.md. The production decision after results is Astra6.2 high primary, Astra6.2/Sol6.2 high comparison; actual deployment is tracked separately. |

## Instruction File Naming

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Preserve existing instruction files; add compatibility files only with explicit approval, without renaming or rewriting existing files. | yes | yes | already present | [x] | Existing AGENTS.md retained. Installed Next16.2.10 Route Handlers guide read; no instruction files renamed. |

## Migrate from Chat Completions to the Responses API

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Migrate applicable OpenAI workloads to the Responses API. | yes | yes | deferred | [ ] | Both selected OpenAI models support the existing Chat Completions single-image strict-JSON call. Keep this compatible route for the requested bounded model upgrade; no tools, multi-turn state or Responses-only product feature is required. Rewriting transport adds a separate failure surface without addressing this task. Applies to single analysis, comparison arms and live evaluation; all reuse defaultAptitudeTransport. |
| Preserve existing product behavior and approved provider compatibility. | yes | yes | deferred | [ ] | Both selected OpenAI models support the existing Chat Completions single-image strict-JSON call. Keep this compatible route for the requested bounded model upgrade; no tools, multi-turn state or Responses-only product feature is required. Rewriting transport adds a separate failure surface without addressing this task. Applies to single analysis, comparison arms and live evaluation; all reuse defaultAptitudeTransport. |

## Streaming

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Preserve existing streaming and user-visible output behavior. | no | yes | not applicable | [ ] | This app renders only a complete, parsed and validated observation. Partial JSON cannot produce a verified answer. Preserve the existing complete-response HTTP workflow; no streaming adapter added. |
| Add streaming only where responsiveness benefits justify the approved change. | no | yes | not applicable | [ ] | This app renders only a complete, parsed and validated observation. Partial JSON cannot produce a verified answer. Preserve the existing complete-response HTTP workflow; no streaming adapter added. |
| Adapt typed Responses streaming events to existing rendering and consumption paths. | no | yes | not applicable | [ ] | This app renders only a complete, parsed and validated observation. Partial JSON cannot produce a verified answer. Preserve the existing complete-response HTTP workflow; no streaming adapter added. |
| Preserve complete-response workflows and defer disproportionate implementation changes. | no | yes | not applicable | [ ] | This app renders only a complete, parsed and validated observation. Partial JSON cannot produce a verified answer. Preserve the existing complete-response HTTP workflow; no streaming adapter added. |

## WebSocket Mode

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Assess persistent transport for long-running or tool-heavy workflows. | no | yes | not applicable | [ ] | Each question is an independent bounded HTTP request without a tool loop. Existing AbortSignal, 25-second deadline, provider refusal/incomplete checks and zero SDK retries are retained; persistent connection/replay behavior is unnecessary. |
| Preserve existing HTTP and streaming behavior when WebSockets add insufficient value. | no | yes | not applicable | [ ] | Each question is an independent bounded HTTP request without a tool loop. Existing AbortSignal, 25-second deadline, provider refusal/incomplete checks and zero SDK retries are retained; persistent connection/replay behavior is unnecessary. |
| Handle structured errors, failed or incomplete responses, and provider-specific concurrency limits; OpenAI allows one active response per `stream_id` lane, with concurrent lanes. | no | yes | not applicable | [ ] | Each question is an independent bounded HTTP request without a tool loop. Existing AbortSignal, 25-second deadline, provider refusal/incomplete checks and zero SDK retries are retained; persistent connection/replay behavior is unnecessary. |
| Recover failed turns according to storage and Zero Data Retention requirements. | no | yes | not applicable | [ ] | Each question is an independent bounded HTTP request without a tool loop. Existing AbortSignal, 25-second deadline, provider refusal/incomplete checks and zero SDK retries are retained; persistent connection/replay behavior is unnecessary. |
| Reconnect safely without duplicating visible output or side-effecting tool calls. | no | yes | not applicable | [ ] | Each question is an independent bounded HTTP request without a tool loop. Existing AbortSignal, 25-second deadline, provider refusal/incomplete checks and zero SDK retries are retained; persistent connection/replay behavior is unnecessary. |

## Data Privacy and Residency

### Zero Data Retention

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Explicitly confirm Zero Data Retention and other retention requirements. | yes | unknown | already present | [x] | Retain existing project credentials, endpoint and provider storage behavior; do not claim account-level ZDR. No new stored-response chain, background task, cache-retention setting or provider is introduced. Fable5.2 is excluded from this change because its mandatory retention requires a separate account review. |
| Verify endpoint, model, feature, tool, caching, and background-execution compatibility. | yes | unknown | already present | [x] | Retain existing project credentials, endpoint and provider storage behavior; do not claim account-level ZDR. No new stored-response chain, background task, cache-retention setting or provider is introduced. Fable5.2 is excluded from this change because its mandatory retention requires a separate account review. |
| Configure stateless storage behavior when required. | yes | unknown | already present | [x] | Retain existing project credentials, endpoint and provider storage behavior; do not claim account-level ZDR. No new stored-response chain, background task, cache-retention setting or provider is introduced. Fable5.2 is excluded from this change because its mandatory retention requires a separate account review. |
| Preserve existing privacy and storage expectations. | yes | unknown | already present | [x] | Retain existing project credentials, endpoint and provider storage behavior; do not claim account-level ZDR. No new stored-response chain, background task, cache-retention setting or provider is introduced. Fable5.2 is excluded from this change because its mandatory retention requires a separate account review. |

### Data Residency

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Identify required storage and processing jurisdictions. | no | unknown | not applicable | [ ] | No jurisdiction requirement or regional endpoint change was requested. Existing account configuration is retained; regional eligibility was not audited and no residency guarantee is asserted. |
| Verify project settings, regional endpoints, and regional model or feature availability. | no | unknown | not applicable | [ ] | No jurisdiction requirement or regional endpoint change was requested. Existing account configuration is retained; regional eligibility was not audited and no residency guarantee is asserted. |
| Confirm residency or regional-processing tradeoffs with the developer. | no | unknown | not applicable | [ ] | No jurisdiction requirement or regional endpoint change was requested. Existing account configuration is retained; regional eligibility was not audited and no residency guarantee is asserted. |

## Processing Tiers

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Assess tier requirements separately for each distinct workload. | yes | yes | already present | [x] | Keep the existing standard/default synchronous processing with no new service_tier parameter. Priority, flex, batch and reserved processing are not selected for this interactive deadline-bound workload. API price and observed latency will be recorded in the model-selection report. |
| Standard processing. | yes | yes | already present | [x] | Keep the existing standard/default synchronous processing with no new service_tier parameter. Priority, flex, batch and reserved processing are not selected for this interactive deadline-bound workload. API price and observed latency will be recorded in the model-selection report. |
| Priority processing. | yes | yes | already present | [x] | Keep the existing standard/default synchronous processing with no new service_tier parameter. Priority, flex, batch and reserved processing are not selected for this interactive deadline-bound workload. API price and observed latency will be recorded in the model-selection report. |
| Flex processing. | yes | yes | already present | [x] | Keep the existing standard/default synchronous processing with no new service_tier parameter. Priority, flex, batch and reserved processing are not selected for this interactive deadline-bound workload. API price and observed latency will be recorded in the model-selection report. |
| Batch processing. | yes | yes | already present | [x] | Keep the existing standard/default synchronous processing with no new service_tier parameter. Priority, flex, batch and reserved processing are not selected for this interactive deadline-bound workload. API price and observed latency will be recorded in the model-selection report. |
| Reserved processing. | yes | yes | already present | [x] | Keep the existing standard/default synchronous processing with no new service_tier parameter. Priority, flex, batch and reserved processing are not selected for this interactive deadline-bound workload. API price and observed latency will be recorded in the model-selection report. |
| Confirm pricing, latency, availability, retention, and developer preferences. | yes | yes | already present | [x] | Keep the existing standard/default synchronous processing with no new service_tier parameter. Priority, flex, batch and reserved processing are not selected for this interactive deadline-bound workload. API price and observed latency will be recorded in the model-selection report. |

## Prompt Caching

### Prompt Cache Keys

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| For GPT-5.6 and later, omit new cache keys by default and preserve existing keys; for earlier models, use stable cache keys for reusable prompt prefixes. | yes | yes | already present | [x] | No new cache key is sent for GPT6.2. Stable system instruction prefix remains before the changing image/question. Existing requests had no explicit key. |
| Avoid cache-key and prefix fragmentation. | yes | yes | already present | [x] | No new cache key is sent for GPT6.2. Stable system instruction prefix remains before the changing image/question. Existing requests had no explicit key. |

### Extended Cache Retention for Earlier Models

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Assess extended retention for eligible models against developer retention requirements. | no | unknown | not applicable | [ ] | This upgrade targets GPT6.2 and leaves legacy profiles untouched. No extended retention parameter is introduced. |

### Explicit Cache Breakpoints for GPT-5.6 and Later

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Apply supported explicit breakpoints to stable, reusable content. | yes | partial | deferred | [ ] | Reusable prompt prefix could benefit from caching, but the retained Chat Completions payload does not implement Responses cache breakpoints. No caching/retention policy change is needed for correctness; diagnose only if measured latency/cost warrants a separate transport change. |
| Choose implicit or explicit-only caching according to conversation and privacy requirements; record any breakpoint deferral separately. | yes | partial | deferred | [ ] | Reusable prompt prefix could benefit from caching, but the retained Chat Completions payload does not implement Responses cache breakpoints. No caching/retention policy change is needed for correctness; diagnose only if measured latency/cost warrants a separate transport change. |

### Prompt Cache Diagnostics

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Plan how to obtain a suitable comparison response ID and use `prompt_cache_options.comparison_response_id` on eligible GPT-5.6-and-later Responses requests; record evidenced workflow or retained-framework limitations. | no | partial | not applicable | [ ] | The retained single-turn Chat Completions route does not use Responses comparison_response_id. This pilot measures actual usage and duration; it does not claim cache-hit attribution. |

## State Management

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Select local or server-side state according to architecture, privacy, and developer approval. | no | yes | not applicable | [ ] | One screenshot per independent request; no prior-question history, stored response IDs, reasoning items or tool replay is sent. UI history stays local and is not provider conversation state. |
| Preserve complete conversation, reasoning, tool-call, and tool-output replay for stateless workflows. | no | yes | not applicable | [ ] | One screenshot per independent request; no prior-question history, stored response IDs, reasoning items or tool replay is sent. UI history stays local and is not provider conversation state. |
| Use stored-response chaining only when retention is permitted and approved. | no | yes | not applicable | [ ] | One screenshot per independent request; no prior-question history, stored response IDs, reasoning items or tool replay is sent. UI history stays local and is not provider conversation state. |

### Instruction Persistence Gotcha

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Preserve durable instructions across stateless replay and stored-response chaining. | yes | yes | already present | [x] | Every request includes the full system prompt and category-detection user instruction. No previous_response_id or implicit instruction persistence is relied upon. |
| Replay instruction input items or resend top-level instructions when required. | yes | yes | already present | [x] | Every request includes the full system prompt and category-detection user instruction. No previous_response_id or implicit instruction persistence is relied upon. |

## Reasoning

### Encrypted Reasoning Items

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Preserve complete encrypted reasoning items across stateless turns and tool calls. | no | partial | not applicable | [ ] | No cross-turn/tool-call replay exists in this workload, so there are no reasoning items to preserve or reconstruct. User-facing output remains a short worked explanation. |
| Preserve original ordering, encrypted payloads, and tool-call identifiers. | no | partial | not applicable | [ ] | No cross-turn/tool-call replay exists in this workload, so there are no reasoning items to preserve or reconstruct. User-facing output remains a short worked explanation. |
| Avoid replacing original reasoning items with summaries or reconstructed text. | no | partial | not applicable | [ ] | No cross-turn/tool-call replay exists in this workload, so there are no reasoning items to preserve or reconstruct. User-facing output remains a short worked explanation. |

### Reasoning Effort

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Explicitly configure supported reasoning effort for each applicable model and workload. | yes | yes | implemented | [x] | Selected profiles use the established high effort with 6,000 total output tokens and the same 25-second deadline. Official model pages confirm image input, strict outputs and reasoning_effort. Transport tests must prove unsupported sampling fields remain omitted. |
| Preserve established preferences or confirm new quality, latency, and cost tradeoffs. | yes | yes | implemented | [x] | Selected profiles use the established high effort with 6,000 total output tokens and the same 25-second deadline. Official model pages confirm image input, strict outputs and reasoning_effort. Transport tests must prove unsupported sampling fields remain omitted. |
| Verify selected model and provider support. | yes | yes | implemented | [x] | Selected profiles use the established high effort with 6,000 total output tokens and the same 25-second deadline. Official model pages confirm image input, strict outputs and reasoning_effort. Transport tests must prove unsupported sampling fields remain omitted. |

### Reasoning Preservation

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Assess supported cross-turn versus current-turn reasoning preservation. | no | partial | not applicable | [ ] | Questions are intentionally independent; retaining previous-question reasoning could contaminate evidence. Existing in-call provider reasoning is retained without history replay. |
| Preserve required history while respecting context size, latency, privacy, and developer preferences. | no | partial | not applicable | [ ] | Questions are intentionally independent; retaining previous-question reasoning could contaminate evidence. Existing in-call provider reasoning is retained without history replay. |

### Reasoning Summaries and Tool-Call Preambles

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Assess reasoning summaries and tool-call preambles for the existing product experience. | no | partial | not applicable | [ ] | No model-driven tools or streamed reasoning summaries are exposed. The schema's existing concise worked explanation serves the product need without disclosing an internal reasoning transcript. |
| Preserve existing user-visible behavior and distinguish summaries from verbosity and message phases. | no | partial | not applicable | [ ] | No model-driven tools or streamed reasoning summaries are exposed. The schema's existing concise worked explanation serves the product need without disclosing an internal reasoning transcript. |
| Verify selected model, provider, and SDK support. | no | partial | not applicable | [ ] | No model-driven tools or streamed reasoning summaries are exposed. The schema's existing concise worked explanation serves the product need without disclosing an internal reasoning transcript. |

## Verbosity

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Configure supported response verbosity for each applicable request. | yes | partial | already present | [x] | Preserve the existing concise JSON explanation contract; prompt requests 1–3 useful steps, maximum six. No new provider verbosity parameter or output surface is introduced. |
| Preserve established preferences or ask the developer before selecting a new setting. | yes | partial | already present | [x] | Preserve the existing concise JSON explanation contract; prompt requests 1–3 useful steps, maximum six. No new provider verbosity parameter or output surface is introduced. |
| Confirm output-length, user-experience, latency, cost, model, and provider compatibility. | yes | partial | already present | [x] | Preserve the existing concise JSON explanation contract; prompt requests 1–3 useful steps, maximum six. No new provider verbosity parameter or output surface is introduced. |

## Maximum Output Tokens

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Preserve existing output limits when appropriate. | yes | yes | already present | [x] | Preserve established reasoning-model cap of 6,000 tokens including reasoning and visible JSON; legacy models remain 3,000. Preserve 25-second deadline and reject incomplete responses rather than treating truncated JSON as a valid answer. |
| Avoid inventing a limit without an application or developer requirement. | yes | yes | already present | [x] | Preserve established reasoning-model cap of 6,000 tokens including reasoning and visible JSON; legacy models remain 3,000. Preserve 25-second deadline and reject incomplete responses rather than treating truncated JSON as a valid answer. |
| Account for both visible output and reasoning tokens. | yes | yes | already present | [x] | Preserve established reasoning-model cap of 6,000 tokens including reasoning and visible JSON; legacy models remain 3,000. Preserve 25-second deadline and reject incomplete responses rather than treating truncated JSON as a valid answer. |

## Assistant Message Phases

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Preserve supported assistant-message phases across requests and replay. | no | partial | not applicable | [ ] | Single complete structured response, no commentary/tool-loop replay. Existing structured parsing is preserved rather than flattened into unvalidated text. |
| Retain structured assistant outputs rather than collapsing them to plain text. | no | partial | not applicable | [ ] | Single complete structured response, no commentary/tool-loop replay. Existing structured parsing is preserved rather than flattened into unvalidated text. |
| Test relevant commentary and tool-loop behavior. | no | partial | not applicable | [ ] | Single complete structured response, no commentary/tool-loop replay. Existing structured parsing is preserved rather than flattened into unvalidated text. |

## Context Compaction

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Assess native compaction for long-running conversations and tool-heavy workflows. | no | partial | not applicable | [ ] | No long-running conversation or accumulated model context exists. One screenshot and fixed instructions do not require compaction. |
| Confirm changes to compaction strategy with the developer. | no | partial | not applicable | [ ] | No long-running conversation or accumulated model context exists. One screenshot and fixed instructions do not require compaction. |
| Configure appropriate in-request or standalone compaction and thresholds. | no | partial | not applicable | [ ] | No long-running conversation or accumulated model context exists. One screenshot and fixed instructions do not require compaction. |
| Preserve encrypted compaction items during manual state management. | no | partial | not applicable | [ ] | No long-running conversation or accumulated model context exists. One screenshot and fixed instructions do not require compaction. |
| Verify privacy requirements and model or provider compatibility. | no | partial | not applicable | [ ] | No long-running conversation or accumulated model context exists. One screenshot and fixed instructions do not require compaction. |

## Structured Outputs

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Preserve required structured-output schemas, validation, parsing, and error handling. | yes | yes | already present | [x] | Preserve APTITUDE_OBSERVATION_JSON_SCHEMA, strict OpenAI response_format, Anthropic output_config, parsing, grid-v1 contract, option mapping and error handling. New model profiles receive the exact same image/schema; focused SDK payload and rejection tests are required. |
| Verify model and provider compatibility and add focused schema tests. | yes | yes | already present | [x] | Preserve APTITUDE_OBSERVATION_JSON_SCHEMA, strict OpenAI response_format, Anthropic output_config, parsing, grid-v1 contract, option mapping and error handling. New model profiles receive the exact same image/schema; focused SDK payload and rejection tests are required. |
| Avoid imposing structured outputs on unrestricted-text workflows. | yes | yes | already present | [x] | Preserve APTITUDE_OBSERVATION_JSON_SCHEMA, strict OpenAI response_format, Anthropic output_config, parsing, grid-v1 contract, option mapping and error handling. New model profiles receive the exact same image/schema; focused SDK payload and rejection tests are required. |

## Tools

### Tool Choice

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Preserve automatic, required, or restricted tool-selection behavior. | no | yes | not applicable | [ ] | No model tool declarations or forced/automatic tool calls exist. Local arithmetic/pattern checks run after parsing under application control. |
| Confirm meaningful changes to tool-use policy with the developer. | no | yes | not applicable | [ ] | No model tool declarations or forced/automatic tool calls exist. Local arithmetic/pattern checks run after parsing under application control. |

### Tool Search and Additional Tools

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Assess deferred tool discovery for large or dynamic tool catalogs. | no | yes | not applicable | [ ] | No model tool catalog or deferred discovery exists. Public benchmark research is separate from user screenshot inference; no live assessment answer scraping is added. |
| Preserve correctly positioned additional-tool items and append-only replay. | no | yes | not applicable | [ ] | No model tool catalog or deferred discovery exists. Public benchmark research is separate from user screenshot inference; no live assessment answer scraping is added. |
| Maintain stable cached prefixes without unnecessary tool-search complexity. | no | yes | not applicable | [ ] | No model tool catalog or deferred discovery exists. Public benchmark research is separate from user screenshot inference; no live assessment answer scraping is added. |
| Confirm adoption or higher-lift implementation with the developer. | no | yes | not applicable | [ ] | No model tool catalog or deferred discovery exists. Public benchmark research is separate from user screenshot inference; no live assessment answer scraping is added. |

### Parallel Tool Calls

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Assess concurrent execution of independent tools. | no | yes | not applicable | [ ] | Existing comparison parallelizes independent model calls, not model-issued tools. Preserve cancellation, shared-image identity and no cross-model draft sharing. Pilot uses exactly three independent candidate calls per fixture without retries. |
| Preserve execution order, shared-state assumptions, approvals, and side-effect controls. | no | yes | not applicable | [ ] | Existing comparison parallelizes independent model calls, not model-issued tools. Preserve cancellation, shared-image identity and no cross-model draft sharing. Pilot uses exactly three independent candidate calls per fixture without retries. |
| Confirm behavior-changing concurrency with the developer. | no | yes | not applicable | [ ] | Existing comparison parallelizes independent model calls, not model-issued tools. Preserve cancellation, shared-image identity and no cross-model draft sharing. Pilot uses exactly three independent candidate calls per fixture without retries. |

### Programmatic Tool Calling

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Assess supported programmatic coordination of tool calls. | no | partial | not applicable | [ ] | No model-driven execution environment or tool coordinator exists; ordinary image inference and application-side validation meet the task. No permissions or side-effect interfaces change. |
| Verify model, provider, SDK, tool, and execution-environment support. | no | partial | not applicable | [ ] | No model-driven execution environment or tool coordinator exists; ordinary image inference and application-side validation meet the task. No permissions or side-effect interfaces change. |
| Preserve permissions, approvals, side-effect controls, and application behavior. | no | partial | not applicable | [ ] | No model-driven execution environment or tool coordinator exists; ordinary image inference and application-side validation meet the task. No permissions or side-effect interfaces change. |
| Distinguish programmatic calling from ordinary sequential or parallel function calling. | no | partial | not applicable | [ ] | No model-driven execution environment or tool coordinator exists; ordinary image inference and application-side validation meet the task. No permissions or side-effect interfaces change. |
| Test execution, results, failures, and changed approval behavior. | no | partial | not applicable | [ ] | No model-driven execution environment or tool coordinator exists; ordinary image inference and application-side validation meet the task. No permissions or side-effect interfaces change. |

### Model-Aligned Tool Interfaces

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Assess conventional repository-search, patch-oriented editing, or other model-aligned tool interfaces. | no | partial | not applicable | [ ] | This app analyzes screenshots, not repository tasks. Search/edit tools are irrelevant to the production inference route. |
| Confirm higher-lift tool redesign with the developer before implementation. | no | partial | not applicable | [ ] | This app analyzes screenshots, not repository tasks. Search/edit tools are irrelevant to the production inference route. |

## Outcome

**Implemented or already present:** Existing single-turn transport, schema, cancellation, bounded reasoning budget and provider-specific validation retained. Prompt upgrade, two candidate profiles, twelve original fixtures and bounded selection runner implemented; production choice recorded from36actual calls in docs/aptitude-model-selection.md.
**Remaining work:** Finish the selected-model production gate and verify the live UI. The overrides are set; two deployments were blocked by confirmed star-evidence wording-matcher false positives (outer points/tips, then outward points). Both runs returned6/6objective and2/2boundary outcomes, and remain recorded. Research, integrated validation, exact-tree publication, frozen pilot and production decision are complete. Responses-only caching, streaming, tools and conversation features are outside this workload.
**Developer decisions requiring follow-up:** None. Existing user authorization covers this bounded upgrade; no further permission is needed.
**Follow-up checker validation:** The outward/outward-facing wording correction passed72focused tests (14additional regressions), and the complete offline Aptitude suite passed201checks with2optional live tests skipped. No prompt, model profile, frozen selection fixture, selection denominator or release criterion changed.
**Validation evidence:** Local full suite: 1,426 tests across179files passed; final38selection tests (including six additional denominator/collection tests) passed. TypeScript, edited-file ESLint and diff checks passed. Eleven policy/transport checks verified the new model payloads. All12rendered fixtures reviewed. CI confirmed1,432tests across179files. Live pilot completed36/36calls with zero operational errors; Astra/Sol each10/10objective and2/2boundaries, Sonnet7/10objective and2/2boundaries. First selected-model deployment was blocked by a confirmed legacy star-evidence wording-matcher false positive, despite6/6objective and2/2boundary outcomes. The narrow matcher correction passed58focused regression tests, including real valid outer-point/outer-tip descriptions, wrong counts and a valid negated contrast. Rerun the existing gate on the corrected commit; keep the failed run as evidence. The frozen pilot is unchanged.
