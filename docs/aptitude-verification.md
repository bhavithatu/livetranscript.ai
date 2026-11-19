# Aptitude verification record

Implementation branch: `codex/aptitude-mode`, based on
`3ede070edc6afaa220826f6f00ddf59950ff07d0`.

## Local checks — 2026-11-18

| Check | Result | Scope |
| --- | --- | --- |
| Full unit suite, Node 22, at most four workers | 1,198 tests passed across 168 files | Existing application, aptitude/capture/navigation, multi-model selection and UI/session tests |
| TypeScript | Passed | Full project `tsc --noEmit` |
| ESLint | Zero errors; two existing unused-variable warnings | Existing `lib/transcription/recovery.test.ts` warnings |
| Next production build | Passed | New `/tools` page and `/api/aptitude/analyze` route included |
| Offline aptitude evaluation | 23 tests passed; live/preparation opt-ins skipped | Scoring, fixture rendering, manifest, comparison budgets, failure-inclusive metrics and false consensus |
| Fixture preparation | 12 PNGs and a manifest generated; preparation test passed | Original synthetic questions; all rendered images reviewed |
| Browser workflow | Results and artifacts are recorded in [PR #52 checks](https://github.com/bhavithatu/livetranscript.ai/pull/52/checks) | Actual application with explicit provider and screen-source stubs |
| Live provider accuracy/latency | Not run | No provider credential is available in this workspace |
| Native source picker and real-device capture | Not run | Requires an interactive supported device/browser |

The first uncapped local unit run hit a five-second timeout in an existing large
remote-frame round-trip test under resource contention. The complete suite passed
with four workers; the test assertion and timeout were not weakened. CI uses the
same worker cap.

## Multi-model comparison

The comparison enhancement adds independent parallel candidates, deterministic
source/option matching, explicit disagreement/insufficient states, and separate
single/comparison history entries. Unit coverage includes malformed answers,
conflicting source evidence, remapped option IDs, a wrong agreeing majority,
timeouts, cancellation, stale mode callbacks and response-strategy mismatch.

The browser workflow additionally checks two-model agreement, a one-to-one tie,
one usable answer plus a timeout, and a three-model majority. Its sample responses
are explicitly labeled in the screen preview; they are not live model outputs.
All four browser response fixtures were independently parsed with the real
runtime contract before publication. The workflow captures the actual comparison
panel and full workspace in desktop/mobile light and dark layouts.

The local browser runner could not launch Chromium because the workspace denied
its socket operation. The connected cloud browser could not reach the local
server. Neither outcome is counted as a successful UI check. The new CI browser
job runs independently and stores the report and screenshots as an artifact.

The first CI attempt exposed runner-image drift: `ubuntu-latest` had moved to
Ubuntu 26.04, which the pinned Playwright 1.55 runtime could not install on. All
three affected browser jobs now pin Ubuntu 24.04. The first actual Aptitude
browser run then exposed an exact-label selector issue in the test: Playwright
included nested option text when reading a wrapping label. The history check now
uses the region's unique combobox and verifies both exact capture IDs in order.
Neither issue was hidden by relaxing the application assertions.

## Reproduce

Use the lockfile and Node 22. No new runtime dependency was added.

```sh
pnpm install --frozen-lockfile
pnpm exec vitest run --maxWorkers=4
pnpm exec tsc --noEmit
pnpm lint
pnpm build
pnpm eval:aptitude
pnpm eval:aptitude:prepare
```

For the browser check, install Playwright 1.55.0 and its Chromium, start the
production server without Clerk/provider credentials, then run
`pnpm test:aptitude:browser`. The workflow contains the exact setup. The browser
report declares `liveModel: false` and `nativePicker: false`; its response timing
must not be cited as model latency.

For live inference, follow the explicit bounded procedure in
[the evaluation guide](../evals/aptitude/README.md). Its synthetic examples
are a pipeline pilot, not a sufficient accuracy benchmark. Real assessment
performance and supported-device capture require additional measured evidence.

## Diagram and preview regression follow-up — 2026-11-18

Production feedback exposed gaps in the initial numerical-question pilot: a
pinned answer was displayed alongside the newest preview, tiny diagrams could
lose detail during repeated image resizing, and a correct calculation could
contradict the model's stated number-pattern rule.

The follow-up binds the sidebar to the selected history capture, exposes an
actual-pixel inspector and visual area selection, preserves image detail within
the request limit, and validates declared numeric-pattern transitions. It also
withholds visual corroboration when the models describe different observed
features, even if their final values match.

Regression coverage includes pinned history while automatic captures arrive,
returning to latest, selector-only images never reaching the analysis request,
fresh detailed recapture on Apply, source termination during selection,
high-resolution colored detail, portrait aspect ratio, payload overflow and
incorrect numeric rule application. Eight new original visual fixtures bring
the evaluation set to twenty, including a paired large-page stress case,
star-point counting, rotating and XOR grids, missing evidence and ambiguity.

At this commit, the offline evaluation passes 33 tests (live inference and image
preparation are separate opt-ins). Live diagram inference and native-browser
verification must be recorded separately after deployment. A passing offline
scorer or stubbed browser workflow is not a measurement of model accuracy.

Clients should reload after this release: new clients accept older responses,
but an already-open old bundle rejects the new optional numeric-pattern field.
