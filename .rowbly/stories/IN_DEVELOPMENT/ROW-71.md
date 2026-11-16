---
title: Better offline handling
stage: IN_DEVELOPMENT
position: 1
createdAt: 2026-11-16T16:32:19.285Z
updatedAt: 2026-11-16T17:10:02.834Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-71
pull_request: https://github.com/sgolovine/rowbly/pull/259
---

## Goal

While the native factory runs, the machine can go offline, or the connection to one AI provider can fail. Today the factory treats a network failure like any other worker failure: the Thread fails with error class `unknown`, the policy starts a new worker after a retry delay, and the supervisor and new launches continue to send requests that fail. Only quota and authentication errors pause a provider (`pausedProviders()` in `src/services/factory-manager/manager-state.ts`).

The user wants the factory to:

- let the user know about the problem with error labels in the app (Thread, header, and other places),
- suspend the background work while it waits for the connection to the AI services,
- handle two cases: one provider has problems, and the internet connection is lost completely,
- resume the tasks automatically when the connection returns.

## Scope

In scope (this Story, the service side):

- Classify a connectivity error of a Pi prompt or a Pi session launch.
- Pause the provider with a new pause reason `network` when a worker or the supervisor fails with a connectivity error. The existing pause gate then stops new launches and supervisor turns for that provider.
- Give the failed worker Thread the error class `transient` and the code `NETWORK`, and keep it resumable.
- Resume these Threads automatically (same Thread, same Pi session, new run) when the pause of their provider ends.
- Add a `connectivity` field to the factory status (`online`, `degraded`, `offline`).
- The existing problem list of the Factory controls already shows each provider pause. With the `network` reason it shows the label `Provider <id> is paused (network) until <time>.` This is the error label of this Story.
- Update the docs and the tests.

Not in scope:

- ROW-73: the TUI labels for the connectivity state in the header, the Thread pane, the Threads tab and the queue reason.
- An active network probe (a ping or a DNS lookup). The next request to the provider after the pause ends is the probe.
- Pi's own retry (`retry: { enabled: false }` stays).
- Git sync failures (`project-sync/`). They have their own attention entries.

## Acceptance criteria

- [ ] A new exported pure function (for example `isConnectivityError(error)`) in `src/services/factory-manager/manager-state.ts` (or a new file next to it) returns `true` for error messages or `code`s that contain `fetch failed`, `ECONNRESET`, `ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `ETIMEDOUT`, `ENETUNREACH`, `EHOSTUNREACH`, `socket hang up`, `network error`, `Connection error` or `terminated`, also in a nested `cause`. It returns `false` for quota (`429`), authentication (`401`) and other errors. A unit test covers each pattern and a negative case.
- [ ] `pausedProviders()` gives a pause `{ reason: "network", retryAt }` for a connectivity error. The first network pause of a provider has `retryAt` = now + 1 minute. Each later network pause in a row of the same provider doubles the delay, with a maximum of 15 minutes. The quota and authentication rules do not change. A unit test covers the delay sequence and the cap.
- [ ] When a worker fails with a connectivity error, `failWorker()` (`src/services/factory-manager/worker-launch.ts`) writes `error: { class: "transient", code: "NETWORK", message, retryAt }` on the Thread, with `resumable: true` when the Thread has a session file. Other failures keep the current error values. A manager test with the faux provider covers this.
- [ ] While a provider has a `network` pause, the manager starts no new worker on that provider and the supervisor sends no digest when its provider has the pause (the existing `isProviderPaused()` and `supervisorPaused` gates). A manager test covers the worker case.
- [ ] When the `network` pause of a provider ends (`clearProviderPauses()` in `supervisor-steps.ts`), the manager resumes each `failed` Thread with error code `NETWORK` on that provider that `canResume()` permits, through the same path as `resumeWorker()` (a new run of the same Thread). The resume does not wait for the supervisor and does not need a person. A manager test covers the automatic resume.
- [ ] If such a Thread cannot resume (no session file, three runs, Story moved, worktree absent), the normal policy retry applies. The policy does not start a new Thread for a Story while the manager can still resume its `NETWORK` Thread. A test covers one of these fallback cases.
- [ ] A successful prompt of a provider resets its count of network pauses in a row, so the next pause starts at 1 minute again.
- [ ] The factory status (`status.json`, `rowbly factory status --json`) has `connectivity`: `offline` when each provider of the supervisor model, the worker model and the worker overrides of the factory settings has a `network` pause; `degraded` when one or more of them has a `network` pause; else `online`. A unit test covers the three values.
- [ ] A connectivity error does not count against the attempt budget of a Story and does not park it. A policy or manager test confirms this.
- [ ] `docs/architecture/native-factory/recovery.md` and `pi-runtime-and-auth.md` (or `runtime-and-locks.md`, where provider pauses are described) explain the `network` pause, the automatic resume and the `connectivity` field, in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Provider pauses: `ProviderPause`, `pausedProviders()` and `isProviderPaused()` in `src/services/factory-manager/manager-state.ts`. The state persists in `status.json` through `manager-status.ts` (`providers`). Add the count of network pauses in a row to `ProviderPause` (for example `failures?: number`) so that it survives a daemon restart.
- Pause clear: `clearProviderPauses()` in `src/services/factory-manager/supervisor-steps.ts` runs on each scan and removes expired pauses. Add the automatic resume after it, outside the state lock, and do not take the Project write lock while you hold the state lock.
- Worker failure: `failWorker()` and `completeWorker()` in `src/services/factory-manager/worker-launch.ts`. The Thread error type is in `src/services/thread/thread-types.ts` (class `transient` already exists).
- Supervisor failure: `deliverDigest()` in `src/services/factory-manager/supervisor-loop.ts` already calls `pausedProviders()` with the supervisor provider.
- Resume: `resumeWorker()`, `canResume()` and `reserveWorker()` with `resumeThreadId` in `src/services/factory-manager/worker-reservation.ts`. Use a generated request ID for an automatic resume.
- Policy retry and budget: `retryDecision()` and `planAttempts()` in `src/services/factory-policy/factory-policy.ts`. Failures already do not count in `finished`, so they do not park a Story.
- Status type: `FactoryStatus` in `src/services/factory/factory.ts` comes from the manager snapshot.
- Pi errors arrive as `PiPromptError` (`src/services/pi-runtime/pi-runtime.ts`) with the `errorMessage` of the last assistant message. Keep the Pi SDK behind the lazy boundary in `src/services/pi-runtime/`. The classification uses only the message text and the `code`/`cause` fields, and does not import Pi.
- Tests: use the faux provider (see `docs/architecture/testing.md`). Keep live credentials out of tests.

## Assumptions

- The split TUI work is ROW-73. This Story gives the label only through the existing provider problem list. Reason: one pull request cannot hold the service work and all the TUI labels.
- Detection uses the error text and codes, not an active probe. Reason: smallest scope; the existing quota and authentication pauses use the same method, and the next request after `retryAt` is a natural probe.
- "Internet goes out entirely" is shown as `connectivity: offline`, derived from the provider pauses. Each provider then waits with its own backoff. Reason: the factory does not need a separate global state to suspend work, because the per-provider gates already stop all launches and supervisor turns.
- The pause starts at 1 minute and doubles to a maximum of 15 minutes. Reason: a short outage must resume quickly; the cap matches the 15 minute quota pause.
- Auto-resume uses the same Thread and Pi session (a new run), not a new worker. Reason: "tasks must auto-resume" means the work continues where it stopped; the resume path already exists. The limit of three runs for each Thread stays; after it the policy retry starts a new Thread.
- A worker that runs on a provider that is not paused continues to run. Reason: the Story asks to plan for one provider with problems, so other providers must keep working.

## Review findings

- CHANGELOG Stage: the merge of `origin/main` into `story/ROW-71` has conflicts in files other than `CHANGELOG.md`. The merge was aborted. Files with conflicts:
  - `.rowbly/stories/ROW-70.md`
  - `.rowbly/stories/ROW-72.md`
- Cause: the branch has factory scan commits (`chore(rowbly): record project changes after scan`: c4a17278, 4f6be1f9, eeb136c5) that change these canonical `.rowbly/` files. Merge `origin/main` and keep the `origin/main` version of these `.rowbly/stories/` files (or remove the `.rowbly/` changes from the branch), so the pull request does not change canonical `.rowbly/` files.
