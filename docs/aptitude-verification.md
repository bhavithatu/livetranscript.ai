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

Repeated live checks exposed a separate evaluator defect: correct literal grid
inventories were rejected when the model changed headings, used abbreviated
panel labels, or placed choice coordinates in the structured options field.
Those cases were captured as offline regressions, but free-form English remained
an unreliable contract for a production gate. Regular-grid provider responses
now include a typed cell inventory, and the release gate compares all source
panels, the missing position and all four choice mappings directly against the
original fixture. Incorrect or incomplete structured inventories still fail;
equivalent English phrasing is no longer a release criterion. This change is
evaluation infrastructure and does not establish general model accuracy.


## Progressive Claude/OpenAI comparison and session recovery

The November 18 follow-up changes the default comparison to Claude Sonnet 5.5
and GPT-6.2 Sol at high reasoning effort. The UI puts both model answers first,
with independent copy actions, response times and model-estimated confidence.
Confidence is not calibrated accuracy and cannot override failed source or
arithmetic checks. Matching answer values with unreconciled descriptions now
receive a distinct evidence-review label instead of implying different answers.

The same parallel provider calls now emit bounded, validated NDJSON completion
events. The first completed answer is displayed while its peer runs. Capture,
attempt, source and model identities reject stale/mismatched events; completed
cards survive a disconnected stream. Copy state and keyboard focus survive the
transition from a partial comparison to its final result. Known grid-v1 tabs
retain JSON compatibility without the new confidence field, so the deployment
does not require losing the old tab's captures to continue analyzing.

The archive retains 100 questions, supports validated JSON export, and restores
the same tab's data for the same authenticated owner from IndexedDB. Storage
failures, seven-day expiry and retention limits are explicit. Interrupted calls
are not automatically retried, and account switches hide/cancel prior work.
See `aptitude-session-review.md` for the limits of reviewing the user's old
forty-question Safari run; that run has not been accessed or graded.

Before publication, the integrated full suite passed 1,530 tests in 181 files,
plus 204 offline aptitude checks (two paid/preparation opt-ins skipped).
TypeScript and the production build passed. Lint had no errors and the two
existing unused-variable warnings in transcription recovery tests. Browser CI
now runs both the signed-out production boundary and the existing development
preview owner, including native IndexedDB reload/export/clear. Browser fixtures
are explicitly stubs; real provider outcomes and latency must be recorded from
the bounded deployment regression and live UI, not inferred from these tests.


## Window-source startup and native copy-focus follow-up

The first progressive release (`f2f47c19`) passed CI Quality with 1,533 tests
across 181 files and the 204-check offline aptitude suite. Browser CI caught a
real native-browser focus loss: disabling a focused Copy button while awaiting
clipboard completion removes its focus. The follow-up uses `aria-disabled`
and a synchronous in-flight guard, preserving focus and suppressing duplicate
activation without changing clipboard or fallback behavior. The browser focus
assertions remain active, including before the second model response arrives.

For the subsequently reported Safari window-sharing issue, the capture hook
now requests one preferred dimension, waits for decoded current-frame data,
rejects ended/muted/disabled sources, and uses current dimensions after a window
resize. Startup has a cancellable ten-second deadline beginning after the user
chooses a source. A muted window can resume the same grant when it supplies
frames again; no automatic retry widens the capture to a full screen.

These changes are supported by WebKit's guidance on intrinsic aspect ratio and
first-frame metadata, and by the browser media readiness contract:

- https://bugs.webkit.org/show_bug.cgi?id=250200
- https://bugs.webkit.org/show_bug.cgi?id=281737
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/readyState
- https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/muted

Thirty-nine focused capture/detector tests passed, covering delayed and stalled
startup, cancellation, source ending, mute/unmute recovery, resizing, native
pixel detail, crops and masks. The user's Safari session was not accessible
through the connected Linux/Chromium computer. Historical WebKit reports support
compatibility hardening, not a claim that this specific Safari failure was
reproduced or its root cause conclusively diagnosed.

The integrated follow-up suite passed **1,540 tests across 181 files** locally.
TypeScript, edited-file ESLint and diff checks passed. Exact-head CI and the
normal eight-call production gate still run on publication.

## Native Mac verification — 2026-11-19

The production `cadc730` build was tested through the native Safari UI using
existing configured Claude Sonnet 5.5 and GPT-6.2 Sol access. Three original
practice captures made six provider calls: both models answered two numerical
questions correctly and both requested a complete capture when answer choices
were missing. First usable answers appeared at 4.7 s and 4.2 s; complete paired
responses took 7.5 s and 7.2 s. The missing-choice comparison completed in 3.1 s.
This is a small integration check, not a representative accuracy benchmark.

Both answerable comparisons retained the evidence-review label. The exported
percentage-change result differed only in paragraph breaks in the stem and
option-label decoration; the strict source gate still preserves literal stem
text. No relaxed source matching was introduced by this follow-up.

Native screenshot upload, progressive provider cards, session JSON export, and
restoration of all three captures after a Safari reload were observed. The
original assessment tab and its retained captures were preserved.

Window sharing did not deliver a stream after permission/selection, and the
screen-sharing attempt likewise remained pending. A separate local page using
only `getDisplayMedia({video:true,audio:false})` and an attached video element
also stayed pending before a source grant. This narrows the observed stall to
source acquisition; it does not establish a Safari root cause or prove window
compatibility. OS picker/permission inspection was unavailable through the
current Computer Use access.

This patch distinguishes waiting for browser selection from waiting for a decoded
frame, shows recovery guidance after 15 seconds without cancelling a slow picker,
and reports startup success to the workspace so cancellation/failure cannot add
a misleading stopped-source preview error. Late grants still release their tracks;
there is no automatic permission retry, source widening, or model request.

Final local verification: 1,544 unit tests in 181 files passed, 204 offline
aptitude checks passed (two opt-ins skipped), and Node 22 production build,
TypeScript, edited-file ESLint and diff validation passed.

A subsequent fully manual Safari attempt still remained pending. The same basic
local diagnostic in Chrome returned a live, unmuted window track, decoded a
1350 × 1602 first frame, and started playback. The selected window showed ChatGPT,
not the original practice fixture; the diagnostic made no uploads and the stream
was stopped. This verifies Chrome's window-rendering path, not an integrated
LiveTranscript capture. The production Chrome workspace requires an existing-account
sign-in before that final check. System Settings and Control Center inspection
remains unavailable even after the user enabled Any App.

## Integrated Chrome window test — 2026-11-19

After the user signed in and explicitly shared the original practice window,
production `cadc730` captured 2528 × 1608 video. Manual analysis returned B/25%
from both Claude Sonnet 5.5 and GPT-6.2 Sol (first answer 4.607 s, total 7.626 s).
Automatic capture of the worker question returned D/30 from both (4.106 s,
7.262 s). A selected crop produced 1821 × 1062 images. The sequence
8,12,18,26,? returned B/36 from OpenAI; Claude's arithmetic consistency check
failed and its answer was withheld. The combined comparison correctly remained
insufficient. Both providers requested a complete capture for missing choices.

The exported Chrome session contains 10 captures, seven complete and three
interrupted, including duplicates and a return to question 1. These are not ten
unique questions. Saved full-window images include pointer and toolbar changes.
A pixel comparison of cropped captures 8 and 9 found 354 pixels differing by at
least 20 in one RGB channel, solely inside x=927–949,y=963–997: the visible mouse
pointer. Cropping had left navigation and the pointer in view.

A local follow-up requests `cursor: { ideal: 'never' }` for detailed aptitude
capture, using the optional W3C Screen Capture preference. Unsupported browsers
may ignore it; no live verification of this new hint is claimed. UI guidance
now explains excluding timers, navigation and the pointer while including all
question content and choices. Detection sensitivity remains unchanged to retain
changed-digit detection. Existing capture/workspace/detector regressions passed
58 tests across three files; TypeScript, edited-file ESLint and diff checks
passed. The earlier full suite and build predate this small follow-up.

Automatic capture was paused. The UI export downloaded successfully, although
the browser control connection detached while waiting for its completion event.
The file was verified locally. The user confirmed sharing was stopped. No new
keys were created. All live checks used production, and local follow-up patches
have not been deployed. Safari source acquisition remains unresolved.

## Best available answers and local difficulty — 2026-11-19

The answer panel now derives one best available response from the validated
candidate outputs, even if another model fails or abstains. Strict corroboration
and its exported wire contract are unchanged. A disagreement can show a visibly
labeled best-effort choice, capped at 45/100, with both provider results retained.
Selection prefers corroboration, then passed arithmetic; indistinguishable
candidates use a disclosed stable order, not the highest claimed confidence.
No global model-quality ranking or accuracy improvement is asserted.

Every completed panel displays a numeric heuristic confidence score. It uses the
chosen model's estimate capped by available support: 95 for agreement, 80 for
majority, 70 for one available answer, 45 for disagreement, and at most 65 while
provisional. Older answers without an estimate use a disclosed 50-point fallback.
No eligible answer yields zero evidence support and no invented choice. These
scores are not calibrated probabilities. Provider confidence remains available
on individual cards. The generic prompt now explicitly asks for confidence on
solved answers, discourages reflexive 99/100 estimates and unnecessary abstention,
and asks for an explicit sequence increment/calculation cross-check.

Difficulty (Easy/Moderate/Hard/Not rated) is computed locally from existing
question structure: reading load, constraints, multi-select, numerical patterns,
and visual transformations. It is not a psychometric difficulty measure or a
prediction of the user's ability. No provider request, tracking event or new
persistent store is added. Private-workspace analytics filtering remains intact.
The existing screenshot-to-provider data path is unchanged, and this cannot hide
activity from the source website. At the user's explicit request, no "answer
now", "review", or "skip for now" action labels are shown or exported.

Validation includes 269 relevant unit/component/privacy checks, 216 offline
aptitude checks (two optional provider/preparation checks skipped), and replay
of ten completed saved live practice results. The replay promotes OpenAI's
correct sequence answer when Claude failed validation, and retains no invented
answer for missing choices. Twelve mixed original fixtures exercise local
question-difficulty classification. These are offline tests and saved-response
replays, not fresh provider inference. The changed prompt still needs a fresh
live-model evaluation; usable credentials are only configured in the hosted
project, not this checkout. No new keys were created or extracted.

The real React recommendation component was rendered into an inspectable static
preview, with copy interactions separately tested in the component suite. Chrome
accessibility inspection confirmed its answer/confidence/difficulty content;
screenshot capture subsequently timed out, so no new visual screenshot evidence
is claimed. The Next production compilation/build passed before removing the
action labels; final targeted tests, type checks and lint cover that removal.
No production deployment or model configuration was changed.

## Final quality review — November 19, 2026

- Whole application suite: 1,609 tests passed across 187 files with two workers.
- Full Next.js production build, TypeScript, and focused lint passed.
- Final scoring correction: five behavioral tests passed; offline selection
  replay and its safety regressions: four checks passed.
- Full Vercel preview build passed, including 30 bounded real provider calls.
- Desktop and 390px mobile design preview inspected in the user's Chrome;
  mobile page width matched the viewport without horizontal overflow.
- Behavioral provider attribution, partial/failure status visibility, text
  contrast, and duplicate-model confidence caps were improved and tested.
- The full preview app redirects to its own sign-in; its newly deployed
  authenticated capture flow requires a fresh preview session. Previous Chrome
  sharing success does not establish that this preview has been tested for
  capture. Safari's earlier sharing limitation remains separately documented.
- Production was not promoted. The preview's build snapshot reused existing
  API access; the temporary OpenAI preview environment target was restored to
  production-only after deployment creation. No key values were read.

Tested preview: https://livetranscript-97hux7b0w-revanth-sai-reddy-venumbaka-s-projects.vercel.app

Interactive design: `/assessment-preview/index.html`; full app:
`/copilot?mode=aptitude`. The design uses explicitly labeled saved or authored
examples and does not make model calls. See the model-selection document for
fresh response results and their limitations.

### Arithmetic correction final checks

The final complete suite passes 1,626 tests across 187 files (106.94 seconds,
two workers). TypeScript and focused lint pass. The correction also passed 92
targeted arithmetic, pattern, comparison, guidance and analysis tests plus an
independent review. Offline re-verification recovers exactly one valid chart
answer without relaxing numeric choice checks. The final preview build
explicitly disables additional paid checks: it reuses the original 30-call
evidence and separate local correction replay. Production remains unchanged.
