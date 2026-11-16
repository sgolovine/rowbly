---
title: Record the host of each worker Thread and attempt
stage: IN_DEVELOPMENT
position: 2
createdAt: 2026-11-16T19:45:01.623Z
updatedAt: 2026-11-16T20:10:50.375Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-83
pull_request: null
---

## Goal

Each worker Thread and each policy attempt records the machine that runs it. The value is `local` for all current work. Later Stories (ROW-84, ROW-95, ROW-96) use this field to place and follow workers on remote worker hosts.

Read the Spec `remote-worker-hosts` for the full design (sections "Terms" and "Status and TUI").

## Scope

In scope:

- A `host` field on `ThreadRecord` (`src/services/thread/thread-types.ts`). `createThread` writes `host: "local"` for each new worker Thread. A Thread record without the field reads as `local`.
- A `host` field on the policy attempts in `state.json` (`PolicyAttempt` in `src/services/factory-policy/policy-types.ts`). The projection (`projectedAttempt` in `src/services/thread/thread-projection.ts`) copies the host of the Thread to the attempt. An attempt without the field reads as `local`.
- The manager keeps the host on each active worker entry (`ActiveWorker` in `src/services/factory-manager/manager-state.ts`, set in `worker-reservation.ts`).
- `factory-activity/` gives the host with the activity of a Story (`StoryActivity` of kind `active` gets `host`).
- `rowbly thread list` and `rowbly thread get` show the host: the JSON output has the field, and the text line of `thread list` shows it.
- `rowbly factory status --json` shows the host on each entry of `threads` in the snapshot (`buildSnapshot` in `src/services/factory-manager/manager-status.ts`).

Not in scope:

- Remote hosts, the host registry (ROW-84), placement (ROW-95), remote execution (ROW-96).
- TUI changes. The TUI does not show the host in this Story.
- A `hosts` list in `status.json`.
- A migration that writes `host` into old files. Old files stay as they are.

## Acceptance criteria

- [ ] A new worker Thread that the manager creates has `host: "local"` in `runtime/threads/<id>.json`. A test examines this.
- [ ] A Thread file without `host` passes validation, and `getThread` / `listThreads` give `host: "local"` for it. A test examines this.
- [ ] A Thread file with a `host` that is not a non-empty string fails validation, in the same way as other wrong optional fields. A test examines this.
- [ ] `projectNativeAttempt` writes the host of the Thread to the attempt in `state.json`. A test examines this.
- [ ] An old `state.json` with attempts without `host` reads without an error. `getFactoryActivity` gives `host: "local"` for an active attempt without the field, and the recorded host for an attempt with the field. A test examines both formats.
- [ ] `factory-state/` keeps unknown v1 keys, as before. The existing tests for unknown keys still pass, and a test examines that `host` on an attempt is kept after a state update.
- [ ] Each active worker entry of the manager has `host: "local"`. A test of the manager examines this.
- [ ] `rowbly thread list --json` and `rowbly thread get <id> --json` have `host` for each Thread. The text line of `rowbly thread list` contains the host. The CLI test in `src/commands/thread/thread.test.ts` examines this.
- [ ] `rowbly factory status --json` has `host` on each entry of `threads`. A test examines the snapshot.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Thread record: `src/services/thread/thread-types.ts` (`ThreadRecord`), `thread-validate.ts` (`hasOptionalFields`), `thread-change.ts` (`CreateInput`, `saveNewThread`), `thread-files.ts` (read path). Give the default `local` at read time, in one place, so that all readers (list, get, watch, cache) get the same value. A save after a read then writes the field. This is permitted.
- Use one exported constant for the host id of the main machine, for example `LOCAL_HOST = "local"`, in the thread service. Do not repeat the string.
- Policy attempt: `src/services/factory-policy/policy-types.ts` (`PolicyAttempt`), `src/services/thread/thread-projection.ts` (`projectedAttempt`). `PolicyWorker` has an index signature, so the old files keep their keys.
- `src/services/factory-state/state-file.ts` (`validAttempt`) does not need to require `host`.
- Activity: `src/services/factory-activity/factory-activity.ts`. It reads `state.json` itself (`Attempt` type, `checkString` on known keys). Add `host` to the checked string keys and to the `active` result.
- Manager: `ActiveWorker` in `src/services/factory-manager/manager-state.ts`. The entry is set in `worker-reservation.ts` (`withEntry(state.active, threadId, { task })`) and updated in `worker-launch.ts` (`attachSession`). Keep the host when the session is attached. `createWorkerThread` in `worker-reservation.ts` gives the host to `createThread`.
- Status: `buildSnapshot` in `src/services/factory-manager/manager-status.ts` maps each Thread to `{ id, storyId, stage, status, result }`. Add `host`. `getFactoryStatus` in `src/services/factory/factory.ts` reads `status.json`; it does not need a change if it passes the Thread entries through. Examine this.
- CLI: `threadLine` in `src/commands/thread/thread.ts`. Keep the command thin.
- ROW-82 (in development) changes `worker-launch.ts`. Keep the change in `worker-launch.ts` small to reduce merge conflicts.
- Do not load Pi in the thread, activity or status paths.
- Update the Thread record and the `state.json` attempt fields in `docs/architecture/native-factory/` where the fields are listed (search for `attemptNumber` and `workerId`). Use STE.

## Assumptions

- The host field is optional in the stored files and the default `local` is given when Rowbly reads the record. Reason: the Story says that a record without the field reads as `local`, and a file migration is not necessary.
- Only worker Threads get a host. A supervisor Thread has no `host` field but also reads as `local`. Reason: the Spec says that the supervisor always stays on the main machine; one default for all records is simpler.
- Validation of `host` accepts any non-empty string, not only registered host ids. Reason: the host registry comes in ROW-84, and a strict check now would block the later Stories.
- `rowbly thread` means `thread list` and `thread get`. Other `thread` actions (cancel, resume, steer, log) do not change. Reason: these are the commands that show Thread data.
- The `host` field goes on the `threads` entries of the status snapshot. The `hosts` list of the Spec is not in this Story. Reason: the Story scope says "show the host", and the `hosts` list needs the host registry.
