# Aptitude verification record

Implementation branch: `codex/aptitude-mode`, based on
`3ede070edc6afaa220826f6f00ddf59950ff07d0`.

## Local checks — 2026-11-18

| Check | Result | Scope |
| --- | --- | --- |
| Full unit suite, Node 22, at most four workers | 1,142 tests passed across 164 files | Existing application and new aptitude/capture/navigation tests |
| TypeScript | Passed | Full project `tsc --noEmit` |
| ESLint | Zero errors; two existing unused-variable warnings | Existing `lib/transcription/recovery.test.ts` warnings |
| Next production build | Passed | New `/tools` page and `/api/aptitude/analyze` route included |
| Offline aptitude evaluation | 10 tests passed; live/preparation opt-ins skipped | Scoring, fixture rendering, manifest and evaluation mechanics |
| Fixture preparation | 12 PNGs and a manifest generated; preparation test passed | Original synthetic questions; all rendered images reviewed |
| Browser workflow | Added to the Quality workflow; result pending | Actual application with explicit provider and screen-source stubs |
| Live provider accuracy/latency | Not run | No provider credential is available in this workspace |
| Native source picker and real-device capture | Not run | Requires an interactive supported device/browser |

The first uncapped local unit run hit a five-second timeout in an existing large
remote-frame round-trip test under resource contention. The complete suite passed
with four workers; the test assertion and timeout were not weakened. CI uses the
same worker cap.

The local browser runner could not launch Chromium because the workspace denied
its socket operation. The connected cloud browser could not reach the local
server. Neither outcome is counted as a successful UI check. The new CI browser
job runs independently and stores the report and screenshots as an artifact.

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
[the evaluation guide](../evals/aptitude/README.md). Its twelve synthetic examples
are a pipeline pilot, not a sufficient accuracy benchmark. Real assessment
performance and supported-device capture require additional measured evidence.
