---
title: Put worker execution behind an executor interface
stage: IN_DEVELOPMENT
position: 2
createdAt: 2026-11-16T19:45:01.115Z
updatedAt: 2026-11-16T20:18:49.347Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-82
pull_request: https://github.com/sgolovine/rowbly/pull/271
---

## Goal

Put worker execution behind an executor interface. Later, a remote executor can run a worker on a worker host (ROW-92, ROW-96). This Story changes no behavior.

Read the Spec `remote-worker-hosts` for the full design.

Today `launchWorker` in `src/services/factory-manager/worker-launch.ts` mixes two concerns:

- The execution of the worker: the worktree, the Pi session, the result tool, the checks tools, the activity tracking, the result collection and the close of the session.
- The decisions of the manager: the `stopping` and Stage checks, the provider pause, the Thread changes (`changeThread`), the worker message and the release of the slot.

Also, the manager keeps the Pi session of each worker in `ManagerState.active` (`ActiveWorker.session: PiSession`). Cancel, stop, steer and shutdown call the Pi session directly. A remote worker has no local Pi session, so these operations must go through the executor.

## Scope

In scope:

- A `WorkerExecutor` interface in `src/services/factory-manager/worker-executor.ts`. It has the operations that a remote executor needs:
  - `launch` — prepares the worktree, opens the session, prompts the worker and collects the result. One method for a new run and for a resume (the Thread record tells which). Or a separate `resume` method that the local executor maps to the same code. The developer selects one; both satisfy the criteria.
  - `stop` — the worker stops; the Thread becomes `interrupted` (shutdown, `stop_worker`).
  - `cancel` — the worker stops; the Thread becomes `cancelled` (`cancelWorker`).
  - `steer` — gives a steering message to a running worker (`steerWorker`), with the same "not working now" refusal.
  - A stream of events to the manager: worktree ready, session opened (model and session file), activity (last activity time, last tool, usage), result reported, finished (final usage) and failed (error, and if the session was open).
- A `LocalExecutor` in `src/services/factory-manager/local-executor.ts` that holds the execution code of `worker-launch.ts`: `prepareWorkerWorktree`, `openFactorySession`, `createResultTool`, `workerChecks`, the activity subscription and timer, `collectWorkerResult` (with the `RESULT:` fallback and the one extra prompt), `cancelThreadChecks` and the close of the session.
- The manager keeps the reservation, the slots, all Thread changes, the provider pause, the `stopping` and Stage checks, the prompt-claim check, the worker message (`workerMessage` through `buildWorkerPrompt`) and the serial queue. The manager reacts to the executor events and writes the Thread record.
- `ActiveWorker` in `manager-state.ts` holds a worker control from the executor in place of `session?: PiSession`. `cancelWorker` (`worker-reservation.ts`), `stopWorker` (`supervisor-tools.ts`), `steerWorker` (`worker-steer.ts`) and `stopFactory` (`factory-shutdown.ts`) use the executor, not a Pi session.
- The manager gets its executor from `FactoryDependencies.executor`. When the value is not given, `createFactoryManager` creates the `LocalExecutor`.
- A test with a fake executor (see the acceptance criteria).
- Update the docs that name `worker-launch.ts`: `docs/architecture/native-factory/checks.md`, `docs/architecture/prompts.md` and `.agents/skills/rowbly-code-style/SKILL.md` (the `WorkerRun` example). Add a short section about the executor to `docs/architecture/native-factory/README.md`. Write all Markdown in STE.

Not in scope:

- A remote executor, a transport or a host agent (ROW-92, ROW-96).
- A change to the worker message, the policy, the Thread format, `status.json` or the CLI output.
- A change to the supervisor session. Only workers use the executor.
- Placement or more than one executor in one manager.

## Acceptance criteria

- [ ] `pnpm test` passes. No expectation in an existing test file changes. (A change to the setup of a test is permitted only if the code that it imports moved; `git diff` of the `*.test.ts` files shows no changed `expect` line.)
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm build` pass.
- [ ] `src/services/factory-manager/worker-executor.ts` exists and has no import of `commander`, `ink`, `react`, `@earendil-works/pi-coding-agent` or `../pi-runtime/` (value or type). `grep` of the file shows this.
- [ ] A test in `src/services/pi-runtime/import-boundary.test.ts` imports `worker-executor.ts` while Pi is mocked to throw, and the import succeeds.
- [ ] The interface has `launch`, `stop`, `cancel` and `steer` (and `resume`, if the developer makes it a separate method), and an event stream with the events of the Scope.
- [ ] Outside `local-executor.ts`, no file in `src/services/factory-manager/` (except tests) calls `openFactorySession`, `prepareWorkerWorktree` or a method of a worker `PiSession` (`abort`, `steer`, `prompt`, `subscribe`, `getSessionStats`). `grep` shows this. The supervisor session is not part of this rule.
- [ ] A new test (for example `src/services/factory-manager/worker-executor.test.ts`) gives a fake executor through `FactoryDependencies.executor`. The fake emits worktree, session, activity and result events. The test shows that the manager writes them into the Thread record and completes the Thread, and that `cancelWorker` calls `cancel` of the fake executor. The fake does not load Pi.
- [ ] `worker-launch.ts` is removed or holds only the manager side of the launch. No execution code stays in it.

## Technical notes

- Files: `src/services/factory-manager/worker-launch.ts`, `worker-reservation.ts` (`startWorkerTask`, `cancelWorker`), `worker-steer.ts`, `factory-shutdown.ts`, `supervisor-tools.ts` (`stopWorker`), `manager-state.ts` (`ActiveWorker`, `FactoryDependencies`, `Manager`), `factory-manager.ts` (`createFactoryManager`).
- Keep the order of the current launch exactly: `beforeLaunch`, the `pending` check, the `stopping` check, the Stage check, the worktree, `assignWorktree` under `serial`, the session, `startWorkerRun` under `serial`, the worker message, the activity tracking, the prompt, `providerSucceeded`, the result, `completeWorker` under `serial`; on error `failWorker`; always `finishWorker`. The manager can veto a step: an event handler that throws (for example "Factory is stopping") stops the launch, as today.
- A `prompt` step needs the worker message, and the message needs the worktree path and the model. Thus the executor asks the manager for the message after the session opens (for example a `message(worktree, model)` callback). `workerMessage()` in `src/services/messages/messages.ts` stays the only place that builds the message.
- The activity write stays at most one write in the queue at a time (`activityWritePending`). The local executor can keep the 1-second timer and emit an activity event; the manager writes it under `serial`.
- The checks tools need `manager.checks` (the check queue). Give the `LocalExecutor` the dependencies that it needs at construction (`paths`, `deps.runtime`, `deps.agentDir`, `deps.shim`, the check queue, the settings). Do not give it the full `Manager` if a smaller input is sufficient.
- Pi boundary: `factory-session.ts` loads Pi lazily through `loadPi`. Keep the `LocalExecutor` on this path. The interface file uses only its own types (for example `WorkerResult`, `ModelChoice`, `ThreadRecord` and a usage type), not `PiSession`.
- Follow the `rowbly-code-style` skill: dash-case files, `.js` import extensions, a `Store` for the short-lived run state, one concern for each file.
- Do not touch the supervisor session in `supervisor-loop.ts`.

## Assumptions

- The interface is a callback event sink (async methods that the executor awaits), not an async iterator. Reason: the manager must veto a step before the next step starts, as the current code does with the `stopping` and Stage checks. A remote executor can map its channel lines to the same calls.
- `steer` is part of the interface. Reason: `steerWorker` calls the Pi session directly today, and a remote worker has no local session. The Story text did not name it, but without it the manager still depends on Pi for one operation.
- `stop` and `cancel` are separate operations, although the local executor does the same abort for both. Reason: the Spec gives them different effects on a remote host (an abandon after a cancel while offline).
- The executor comes through an optional `FactoryDependencies.executor`, with the `LocalExecutor` as default. Reason: this is the smallest change that lets a test give a fake and lets ROW-96 add a remote executor. It is not a production faux-provider flag, because it is a code dependency and not a user setting.
- The manager writes all Thread changes; the executor never calls `changeThread`. Reason: the Story says that the Thread changes stay in the manager, and ROW-96 needs the same handlers for the events of a host.

## Review findings

The CHANGELOG Stage found merge conflicts between `story/ROW-82` and `origin/main` (commit `f734b01c`, the merge of PR #269 for ROW-83). The merge was aborted. No changelog entry was written.

Files with conflicts:

- `src/services/factory-manager/manager-state.ts`
- `src/services/factory-manager/worker-steer.test.ts`

Merge `origin/main` into `story/ROW-82`, repair the conflicts, run all checks and push. Then the Story can go to the CHANGELOG Stage again.
