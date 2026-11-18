# Aptitude mode

## User workflow

Open **Aptitude** from the workspace navigation or visit `/copilot?mode=aptitude`.
The mode starts without screen or microphone capture. Share a chosen screen,
upload a PNG/JPEG/WebP screenshot, or load the original practice question.
Inspect **Capture preview**, then choose **Analyze this capture**. Sharing and
automatic analysis are separate actions. **Start automatic capture** enables
question-by-question capture for the active source, without another confirmation
for each frame. Pause, Stop analysis, and Stop sharing remain reachable.

The answer card shows the exact choice label and text, a brief worked explanation,
captured evidence, an explicit verification status, and measured elapsed time.
Missing passages/options and ambiguous questions withhold the answer and explain
what needs another capture. The question category is detected automatically or
selected through a native select. Supported objective categories are numerical,
data interpretation, verbal, critical reasoning, logical, abstract, spatial, and
checking/comparison. Personality and situational judgment are explicit unsupported
objective-answer states; a verbal question's listed “Cannot say” can still be a
valid solved answer.

**What was captured & read** expands the source screenshot, parsed stem, passage,
instructions, options, evidence and actual model identity. UI capture numbers are
local history labels; the internal question hash is never represented as a source
question number. There is no automatic option selection or submission on another
website.

## Region selection and change detection

The shared-screen controls expose a question rectangle and excluded rectangles
in percentages of the full shared source. Excluded rectangles are blanked in
both the uploaded image and the local detector. The preview is the exact image
that will be analyzed. Include the full question, passage, chart and options;
exclude timers, navigation, or unrelated changing regions when appropriate.
Uploaded files use their own original preview and are not silently altered by
shared-screen coordinates.

`useScreenStream.sampleFrame` is independent of legacy `grabFrame` deduplication.
Manual capture remains usable even when an automatic watcher has sampled the
same screen. Images are scaled to a readable bounded size and compressed before
submission. Permission acquisition, video startup, replacement streams, browser
Stop, page exit and unmount use generation-scoped cleanup.

`AptitudeCaptureDetector` keeps separate previous-sample and accepted-image
baselines. It compares localized RGB differences, waits for stability, and keeps
watching while analysis is in flight. Equal-luminance color changes are meaningful.
The initial tuning is 350 ms local sampling and 750 ms stability; this is a
heuristic configuration, not a measured latency or capture-accuracy promise.
There is no 15-second pause after a capture in this mode.

The detector recognizes visual changes, not an assessment's private DOM or a
semantic “next question” event. Unmasked countdowns, hover/selection highlights,
scrolling and stable loading labels may create candidates. Blank/unavailable or
continuously changing frames do not complete stability. Cropped or incomplete
content is handled by the analysis contract. There is no automatic merging of
separate views into one long question: capture a complete replacement view.

## Capture and answer identity

Every analysis carries a capture ID and incrementing attempt version. The client
also fences active requests by generation and controller identity. New questions
cancel old requests; late results cannot update a newer question, including when
the transport ignores cancellation. A newly loaded preview cannot show an earlier
answer as if it described that image. While a changed screen settles, the previous
suggestion is withheld from the current view. Explicitly pinned history stays
clearly labeled and does not stop new captures.

The last 12 captures remain in tab memory. Clear removes screenshots and answers;
reload removes the session. No captured question image is stored in localStorage.
Exact image bytes plus the chosen category can reuse a completed validated result
or coalesce an in-flight request. **Retry this capture** always starts a new
attempt. A weak visual hash, similar stem, or old option letter is never enough
to reuse an answer. Different option order/content remains a different image.
The server's SHA-256 question identity includes the image and extraction; it is
not semantic deduplication across differently rendered questions.

## Server contract and correctness checks

`POST /api/aptitude/analyze` accepts a bounded authenticated same-origin request:

```ts
{ captureId, questionVersion, image, category: 'auto' /* or a supported category */ }
```

The endpoint validates request fields, base64/image signatures, supported image
types and dimensions before any model call. The 3.5-million-character image cap
keeps the JSON body below the hosting request limit. The existing generic answer
endpoint rejects `mode: aptitude`; the dedicated workflow cannot fall into its
image-less speculative draft behavior.

One multimodal call extracts, classifies and proposes a structured answer.
Provider output passes strict runtime validation. Selected IDs must exist in the
captured options, single/multiple-choice cardinality must agree, and a solved
answer must have complete evidence and a worked explanation. Partial/malformed
JSON and fabricated option references never become completed answers.

The restricted calculator uses exact rational arithmetic and explicit rounding.
It accepts only bounded numeric expressions; no generated code or unrestricted
`eval` runs. Arithmetic/answer/option disagreement removes the answer and returns
an ambiguity state. Arithmetic agreement does not establish correct OCR, units,
formula selection or reasoning. Other answers explicitly say no independent
correctness check was performed. No calibrated confidence percentage is invented.

The server shares a 25-second deadline across configured attempts, disables SDK
retries, and prevents further fallback after cancellation. The client has a
45-second deadline to include upload and request overhead. These are failure
bounds, not expected answer times or assessment time allowances.

## Provider configuration

Reuse the existing server-only provider credentials. Choose an explicit entry
from `lib/aptitude/modelPolicy.ts` with `APTITUDE_MODEL`. The default is
`anthropic:claude-sonnet-4-5` when the Anthropic key is present, otherwise
`openai:gpt-4.1`. Optional `APTITUDE_FALLBACK_MODELS` contains at most two additional
allowlisted entries. Every configured candidate must have its corresponding key.
Unknown models or absent credentials return a clear 503. Actual account/model
access still needs a live check.

Every fallback retains the same image and structured response contract. The
allowlist records image and structured-output capability; it is not a model
ranking. No provider was selected on an unmeasured aptitude accuracy claim.
OpenAI requests use high image detail. See the evaluation README for capability
sources and supported candidates.

Private workspace routes and `/api/aptitude/` are excluded from product analytics;
all API responses use `no-store`. Per-attempt usage contains model identity,
duration, available token counts and completion status, without screenshots,
questions, answers or capture IDs. No prompt or raw provider error is logged.

## Discovery of existing features

`WorkspaceShell` now presents the primary tools as ordinary visible links.
`/tools` provides descriptions and deep links for all six AI modes, repository
coach and classic repository screen tools, candidate practice, Mock Lab, session
feedback, recordings, meetings, transcript history, remote assistance, profile,
answer preferences, audio/vocabulary, appearance and desktop installation.
The same Aptitude and catalog destinations appear in focused navigation and the
public mobile menu. Existing interview exit guards and mobile keyboard behavior
remain owned by the existing shell/page components.

## Verification and release evidence

See [the verification record](aptitude-verification.md) for completed checks and
the remaining live-provider, browser and device boundaries.

Run the existing project gates with Node 22:

```sh
pnpm test
pnpm exec tsc --noEmit
pnpm lint
pnpm build
pnpm eval:aptitude
```

Focused tests cover capture changes and masks, late browser permissions, exact
image deduplication, stale answers, pin/retry/clear, source/region/upload races,
timeouts, auth/origin/payload checks, image capability, cancellation, provider
payloads, invalid output/options, and arithmetic disagreement.

`evals/aptitude` provides 12 original rendered screenshots, expected answers,
development/held-out labels, scoring and a hash manifest. Its offline tests check
the evaluation mechanics, not AI accuracy. Live runs require explicit model
selection, credentials, reviewed hashes, and an enforced call cap. Reports retain
failed/aborted attempts and actual latency/tokens. See
[the evaluation guide](../evals/aptitude/README.md).

`qa/aptitude/verify.py` exercises the actual Next application with a synthetic
canvas MediaStream and an explicitly mocked provider response. It checks the
real unauthenticated endpoint, sample/upload input, history, missing evidence,
provider recovery, stable automatic capture, rapid changes, pause/manual retry,
cleanup and light/dark layouts. The Quality workflow runs it against a production
build and saves its report/screenshots as an artifact. This browser test does not
certify a native source picker, operating-system capture permissions, background
tab behavior or a model's answer quality.

Production sign-off still requires a configured-account live evaluation and
real source-picker/device checks. No live model accuracy, P50/P95 answer-time
claim, desktop platform certification, or production deployment is implied by
the deterministic test results.
