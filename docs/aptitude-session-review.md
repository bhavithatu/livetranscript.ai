# Aptitude session review and local recovery

## What can be reviewed from an existing session

The previous implementation retained only the latest twelve entries in React
memory. Reloading, closing the tab, or clearing history removed those entries.
The Aptitude analyze route returned the result to that tab; it did not write
question screenshots or model answers to a server-side session record.

`recordUsage` emits model/provider, duration, token counts and completion status
to PostHog. Diagnostics deliberately contain metadata only. The existing database
`sessions` table stores transcripts and is not an Aptitude question archive.
These sources may help measure usage or operational failures, but they cannot
reconstruct the questions, determine the selected options, or grade a prior run.

A browser session that is still open should be preserved before refreshing. If
that browser is unavailable to the connected tools, do not substitute another
browser's empty history or describe synthetic evaluation questions as the user's
session. Obtain the retained captures and model suggestions from the user.
Questions that already left the old twelve-entry buffer cannot be recovered by
installing the new archive feature afterward.

## New local session archive

The archive keeps up to **100 retained entries** for the current browser-tab
session and signed-in account. An account-scoped tab ID is stored in
`sessionStorage`; capture images and validated results are saved in IndexedDB
on the same origin. A restored manifest must match both the tab's session ID and
the authenticated owner supplied by the server. Switching accounts remounts the
question workspace and cannot restore the previous account's captures. Ordinary
new tabs do not automatically open another tab's session. This is browser-local storage,
not a cloud backup or account-wide history. Private browsing, storage policies,
site-data clearing and browser eviction can prevent recovery.

Without an authenticated owner, saving is disabled with an explicit notice;
in-memory captures and manual export remain available. The existing explicit
non-production `PREVIEW_NO_AUTH=1` mode may supply its existing `preview_user`
identity for local development. The archive does not create an anonymous account
or change authentication rules. Local storage is not encrypted; use the site's
data-clearing controls when removing data from a shared browser profile.

Reloading the same tab can restore a saved session. A request interrupted by a
reload becomes stopped; its capture and any fully validated model responses
already received remain available. It never resumes an old request or silently
submits another paid model call. Each saved answer is checked against its capture
ID, attempt number, selected analysis mode and response schema before display.
Unknown metadata is excluded from exports, and malformed or foreign session
records are not loaded.

Writes are serialized with clearing and update only changed entries so a new
model response does not rewrite every screenshot. Saving has a 200 MiB textual
size limit in addition to the 100-entry limit. The prior saved version is kept
if saving exceeds a bound or fails. The UI must show the returned warning and
must not claim that a failed save or clear succeeded. Current in-memory captures
remain usable and exportable even when browser storage is unavailable.
If a saved copy cannot be read safely or clearing fails, further writes are
paused until clearing succeeds, so an automatic empty save cannot overwrite
unread history. This condition remains visible after subsequent save attempts.

Saved sessions expire after seven days; expired records are removed when the
archive is next opened. **Clear captures and history** removes the current
session's saved copy as well as its in-memory view. Clearing is ordered after
pending saves, preventing a late write from restoring cleared captures.

## Export for an answer review

**Export session** produces a JSON file containing every retained entry's exact
capture image, capture/analysis timestamps, category, latest attempt number,
model suggestions, returned model names, checks and optional confidence values.
The export also retains completed progressive candidates when another model is
still pending. Confidence values are explicitly described as uncalibrated model
estimates, not measured accuracy.

The file contains screenshots and question text. Export occurs only on the
user's action; the archive does not send its content to a server. Share the file
only with someone intended to review that material.

The app **does not observe the answers submitted on another website** and does
not know the assessment's answer key. Exports therefore record
`submittedAnswersRecorded: false`, `answerKeyIncluded: false` and
`accuracy: null`. They retain the latest attempt per entry, not all discarded
retry attempts. Capture counts are not a claim that every capture is a distinct
semantic question.

A review should distinguish:

1. Whether the screenshot contains the complete, readable question and options.
2. Whether each model transcribed the relevant evidence correctly.
3. Whether its suggested answer is correct against an independently checked key.
4. Whether the user's submitted answer is known or remains unobserved.
5. Time to the first usable answer, time to both answers, and capture/review time.

Forty questions in fifteen minutes is a user-reported pace of **22.5 seconds per
question**. It says nothing by itself about how many answers were correct, and
the model-response duration is only one part of that total.
