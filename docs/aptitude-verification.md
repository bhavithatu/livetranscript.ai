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

The initial follow-up offline evaluation passed 33 tests (live inference and
image preparation were separate opt-ins). Live diagram inference and native-browser
verification must be recorded separately after deployment. A passing offline
scorer or stubbed browser workflow is not a measurement of model accuracy.

The first follow-up CI run passed all 1,232 unit tests but exposed an obsolete
browser-test assumption: a reuploaded PNG now retains identical bytes, so the
session correctly reuses its existing analysis. The browser test now checks that
reuse explicitly, then uses a genuinely distinct owned image for history tests.
It also re-pins a saved result after an explicit source change before checking
that automatic captures preserve the selected history view.

Production builds now run a bounded four-image Aptitude acceptance check through
the actual provider path before `next build`. It tests all two or three configured
comparison models with eight or twelve calls, without retries or fallback. Wrong
answers, invalid responses, incomplete-capture guessing and failed evidence
rubrics block the build. An explicitly enabled branch preview can run the same
check; normal local, CI and preview builds make no Aptitude provider calls.
`/aptitude-readiness.json` records the deployed commit, model identities, calls,
candidate correctness, evidence review and measured latency. Conservative source
reconciliation is reported separately from a correct published selection. This
small original-fixture check is a release regression gate, not a general model
accuracy estimate or verification of a user's browser/device.

Clients should reload after this release: new clients accept older responses,
but an already-open old bundle rejects the new optional numeric-pattern field.

## Live regression evidence — 2026-11-18

Production commit `bdbd52fbbbcc4aa80a26327a30b6fbc389b423c8` passed the bounded
live-provider release gate with `openai:gpt-6-sol` and
`anthropic:claude-sonnet-5-5`. Each received the same four original fixtures:

| Original fixture | Both provider results | Total fixture time |
| --- | --- | --- |
| Star-point counting | C, 49; correct four/five/seven point inventory | 6.554 s |
| Increasing differences around a star | B, 36; correct numeric rule | 4.724 s |
| Quarter-turn grid | D; correct panel and choice cell inventories | 11.804 s |
| Grid with cropped choices | `needs_capture`, no answer | 6.768 s |

That is six correct individual answers, two appropriate incomplete-capture
abstentions, zero schema/provider failures and zero evidence-rubric flags across
eight calls. The conservative comparison selector abstained on all three
complete questions because the transcriptions did not reconcile exactly; these
are not six automatically selected comparison answers. This small fixture pilot
does not establish general assessment accuracy or correctness of every sentence.

An interactive production check used the native Chrome tab picker, then the
question-area selector. It produced an 872 × 520 capture of the original
increasing-differences fixture and a correct B, 36 answer in 6.0 s. An uploaded
1080 × 640 star-point fixture produced C, 49 in 7.8 s; Actual pixels displayed
the original 1080 × 640 dimensions. Selecting that older history entry restored
its image, timestamp and answer together; returning to latest restored the
newer capture. Applying a crop alone did not start analysis. Sharing was stopped
afterward. These checks cover this Chrome environment, not Safari on the user's
Mac or every supported device.

All CI gates on that commit passed after one main Quality rerun: 1,292 unit
tests across 176 files; 85 offline Aptitude checks (two opt-ins skipped); 21
Aptitude browser checks across six layouts; repository QA; Windows; and the
existing UI suite's 42 layouts and 28 live layouts. The initial Quality attempt
had one five-second raster-test timeout and 1,291 passes. Its full-byte assertion
used a generic matcher over 720,000 entries. The follow-up keeps the same image,
checks every byte with native byte equality, and explicitly verifies adjacent
one-pixel colors. The isolated test fell from 2,182 ms to 214 ms locally without
changing timeouts or reducing its fixture.

## Capture responsiveness and simpler controls follow-up

The watcher now polls a bounded local fingerprint and encodes a full native
image only after a stable change. Regression tests cover source changes between
observation and full capture, failed acquisition without consuming a candidate,
manual-capture rebasing, timer changes, persistent small changes and cancellation.
Manual Analyze always captures the current shared source, including while it is
settling, and never silently resends an old frame after acquisition fails.

The default screen moves model/type selection and precise region settings into
Advanced options and collapses navigation to other AI modes. Saved history uses
one selector. Copy answer reports clipboard success or exposes a selectable
fallback; it does not claim control of another website. Focused UI tests cover
these actions. The exact combined commit's full-suite and browser results are
recorded in the linked PR checks; stubbed browser timing is not provider latency.
