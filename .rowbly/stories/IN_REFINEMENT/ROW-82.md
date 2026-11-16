---
title: Put worker execution behind an executor interface
stage: IN_REFINEMENT
position: 1
createdAt: 2026-11-16T19:45:01.115Z
updatedAt: 2026-11-16T20:06:48.816Z
worktree: null
pull_request: null
---

## Goal

Put worker execution behind an executor interface. Later, a remote executor can run a worker on a worker host. This Story changes no behavior.

Read the Spec `remote-worker-hosts` for the full design.

## Scope

In scope:

- A `WorkerExecutor` interface in `src/services/factory-manager/`. It prepares the worktree, opens the session, prompts the worker, reports activity and results, and stops the worker.
- A `LocalExecutor` that holds the current code of `launchWorker` (`worker-launch.ts`): worktree, Pi session, result tool, checks, activity and finish.
- The manager calls the executor through the interface. The reservation, the slots, the Thread changes and the serial queue stay in the manager.

Not in scope:

- A remote executor.
- A change to the worker message, the policy or the Thread format.

## Acceptance criteria

- All current factory tests pass without changes to their expectations.
- The executor interface has no import of `commander`, `ink` or `react`, and does not load Pi outside `src/services/pi-runtime/`.
- The interface has the operations that a remote executor needs: launch, stop, cancel, resume, and a stream of activity and result events.
