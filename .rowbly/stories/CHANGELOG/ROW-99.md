---
title: Hold the changes of abandoned remote Threads
stage: CHANGELOG
position: 18
uid: 44146b02-a32e-4d9a-b59a-97620af46408
dependsOn:
  - ROW-94
  - ROW-97
createdAt: 2026-11-16T19:45:12.293Z
updatedAt: 2026-11-17T00:30:42.072Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-99
pull_request: https://github.com/sgolovine/rowbly/pull/300
---

## Goal

When the user cancels a remote Thread while its host is offline, the late changes of that Thread never go to the board automatically. The main machine holds them, and the user applies or discards them later.

Read the Spec `remote-worker-hosts`, sections "Abandoned Threads" and "The outbox".

## Scope

In scope:

- **Abandon on cancel.** A cancel of a remote Thread (`thread.host` is not `local`) whose `cancel-thread` command cannot reach the host (it goes into the durable queue of ROW-97) marks the Thread abandoned. The Thread becomes `cancelled` (as today) and gets an `abandoned` note: `{ at, reason: "cancel", appliedSeq }`. `appliedSeq` is the last applied `seq` of the host (`readAppliedSeq`) at the time of the cancel.
- **The stop goes first.** The `cancel-thread` command of the Thread stays in the queue file `runtime/hosts/<host>/commands.json`. On reconnect, it goes before the `host attach` channel and before the outbox sync (the existing order of `reconnectHost`).
- **No host sync wait.** The Story does not wait on `waiting for host sync` for an abandoned Thread. The usual cancel rules apply (`nativeCancelled`, `cancelled by user`).
- **Held entries.** Each outbox sync of the host (the scan sync, the end-of-run sync and the reconnect sync) holds each entry whose `threadId` is an abandoned Thread and whose `seq` is greater than the `appliedSeq` of the note. The apply does not apply a held entry. Under the Project write lock, it writes the entry to `runtime/hosts/<host>/held/<threadId>/entries.jsonl` and the PNG of an `attachment.add` entry (from `source.blob`) to `runtime/hosts/<host>/held/<threadId>/blobs/<sha256>.png`. Then it records the `seq` as applied, as for the other entries, and the sync sends the acknowledgement.
- **Reconnect for abandoned Threads.** The reconnect of a host also runs when the host has an abandoned Thread without a `remoteOutcome`. It sends the queue, opens the `host attach` channel, takes the run frame of the abandoned Thread, and runs the outbox sync, also when the host has no other open run.
- **Remote outcome.** When the final run frame (`phase: "ended"`) of an abandoned Thread arrives, the main machine writes `remoteOutcome` on the Thread: the end reason, the `endedAt`, the result and the failure of the run, when there are. The Thread stays `cancelled`. Its status, `resultReported` and `completed` do not change, and the Story does not move.
- **Attention.** One attention entry for each abandoned Thread with held entries, key `abandoned:<threadId>`, with the Story ID and a summary: the host, the number of held entries, and the paths and attachment ids that they change. A dismiss removes the attention entry, not the held entries. A new hold for the same Thread sets the entry again.
- **CLI.** `rowbly thread held <id>` lists the held entries of the Thread (`seq`, Story, paths or attachment id). `--apply` applies them with the same compare-and-set as the outbox apply (`applyFieldEntry`, `applyAttachmentAdd`, `applyAttachmentRemove`) under the Project write lock, with the PNG files of the held folder. `--discard` deletes the held folder of the Thread. `--apply` and `--discard` together give a `ValidationError`. `--json` output through `run()`. The command does not need a running factory.
- **Resume gate.** A resume of an abandoned Thread gives a `ConflictError` while it has held entries, or while its host is not `connected`.
- Tests next to each new or changed service. Documentation in STE: the abandoned note and the held folder in `docs/architecture/storage.md` and `docs/architecture/native-factory/runtime-and-locks.md`, the abandon steps in `docs/architecture/native-factory/README.md`, and `rowbly thread held` in `docs/architecture/cli.md`.

Not in scope:

- The release of a remote Thread. Rowbly has no release action today. ROW-119 adds it and uses the abandon steps of this Story with the reason `release`.
- The drop of inbound updates for an abandoned Thread. ROW-98 (inbound updates) is not done. This Story exports a predicate (for example `isAbandoned(thread)`) that ROW-98 uses to drop them.
- The TUI key. ROW-102 adds it.
- The recovery after a restart of the daemon (ROW-117). The abandoned note is on the Thread file, so a later Story can read it after a restart.
- The production SSH wiring (ROW-116).

## Acceptance criteria

- [ ] Cancel while offline: with the fake transport (`createFakeHostTransport`) and one injected worker host, a cancel of a running remote Thread while the host is disconnected makes the Thread `cancelled` with an `abandoned` note (`reason: "cancel"`, `at`, `appliedSeq`). The Story does not have the reason `waiting for host sync`. A test examines this.
- [ ] Stop first: on reconnect, a test examines that the transport gets the queued `cancel-thread` of the Thread before the `host attach` channel opens and before `host outbox`.
- [ ] Held entries: a test makes the host write field and `attachment.add` entries for the Thread after the cancel. After the reconnect, the canonical Story does not change, the entries and the PNG are in `runtime/hosts/<host>/held/<threadId>/`, `outbox-applied.json` has the last `seq`, and the host got `outbox-ack`. The entries of a different Thread of the same host are applied as usual.
- [ ] Remote outcome: after the reconnect, the Thread has `remoteOutcome` with the end reason and the result of the run, and its status stays `cancelled`. `completed` and `resultReported` are not called. A test examines this.
- [ ] Attention: after the hold, the attention has one entry `abandoned:<threadId>`. After a dismiss, the held entries stay. A test examines this.
- [ ] Apply two times: `thread held <id> --apply` applies the held entries to the canonical Story and removes the applied entries. A second `--apply` changes nothing and gives no error. An entry with a conflict stays held, and the result lists the conflict. A test examines this.
- [ ] Discard: `thread held <id> --discard` removes the held folder, and the canonical Story does not change. A test examines this.
- [ ] Resume gate: a resume of the abandoned Thread gives a `ConflictError` while it has held entries, and while its host is not `connected`. After a discard and with a connected host, the resume check passes. A test examines this.
- [ ] Cancel while connected: a cancel of a remote Thread while the host has an open channel does not make the Thread abandoned. Its outbox entries are applied as before. The existing remote executor and reconnect tests pass with no change of expectations.
- [ ] The new modules on the scan and reconnect paths do not load Pi. `src/services/pi-runtime/import-boundary.test.ts` imports them while Pi is mocked.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- **Base.** ROW-97 is on `origin/main` (`08369fdb`). The detached `HEAD` of this worktree at refinement time (`97857930`) does not contain it. Start the branch from `origin/main`.
- **Thread record.** Add `abandoned?: { at: string; reason: "cancel" | "release"; appliedSeq: number }` and `remoteOutcome?` to `ThreadRecord` in `src/services/thread/thread-types.ts`, to `ThreadPatch`, and to the checks of `src/services/thread/thread-validate.ts`. The write of `remoteOutcome` on a `cancelled` Thread is a patch without a status change. Use or extend `transitionThread` in `src/services/thread/thread-change.ts` so that the revision check stays.
- **Cancel path.** `cancelWorker` in `src/services/factory-manager/worker-reservation.ts` calls `control.cancel()`, which calls `stopRemote(env, threadId, "cancel")` in `src/services/remote-executor/remote-stop.ts`. `submitStop` gives false when the host has no open channel or the transport fails, and then `queueStop` queues `cancel-thread` and `endWait` ends the wait. The abandon note is written in this case. The executor gets no full manager, so give the abandon step to it through `RemoteExecutorInput` (for example an `abandoned(threadId)` callback) or give the result of `cancel` back to the manager.
- **Host sync.** `runRemote` in `src/services/factory-manager/worker-launch.ts` calls `hostSynced` in `finally`. `endWait` resolves the launch, so the Story leaves `hostSync` at once. Keep this.
- **Hold in the apply.** `applyOutboxEntries` in `src/services/outbox-apply/outbox-apply.ts` gets the abandoned Threads of the host (thread id and `appliedSeq`), for example as a field of `ApplyOutboxInput`. `applyOne` holds an entry of an abandoned Thread instead of `entryConflicts`, then records its `seq` as usual. A failure of `source.blob` with a transport error stops the apply before the `seq` record, as for an `attachment.add` entry today. A bad PNG keeps the entry held without the PNG; a later `--apply` gives a conflict for it.
- **Held files.** New module, for example `src/services/outbox-apply/held-entries.ts`. Use `hostDir`, `preparedHostDir` and `runtimeChild` of `host-files.ts` (folders mode 0700, files mode 0600). Write `entries.jsonl` with `writeFileAtomic(..., { durable: true })`. The held files change only under the Project write lock.
- **Reconnect.** `needsReconnect`, `reopenLink` (`src/services/remote-executor/remote-reconnect.ts`) and `syncHost` (`remote-sync.ts`) look only at open runs. Extend them for abandoned Threads without `remoteOutcome`. `dispatchFrame` in `remote-channel.ts` gives a run frame only to a run in `env.state.current.runs`. Route the run frame of an abandoned Thread to the `remoteOutcome` write. `host attach` sends the `run.json` of each Thread of the host runtime, so the final frame arrives on the new channel.
- **Attention.** Add the step next to `src/services/factory-manager/outbox-attention.ts`, with `withEntry`. Set the entry after the Project write lock is free.
- **Resume.** `resumeWorker` and `appendResumeRun` in `worker-reservation.ts`. Read the host state from the heartbeat state of the manager (`host-heartbeat.ts`, `host-slots.ts`).
- **CLI.** Add `registerHeld` to `src/commands/thread/thread.ts`. The service goes in `src/services/` (for example `src/services/outbox-apply/held-entries.ts`). The command stays thin.
- **Locks.** The hold and `--apply` hold the Project write lock and never the state lock. Do not take the Project write lock while you hold the state lock.

## Assumptions

- "Offline" means that the `cancel-thread` command cannot reach the host now: no open `host attach` channel, or a transport error on the submit (the same test as `submitStop`). Reason: this is the existing rule that puts a cancel in the queue, and a test can make it with the fake transport.
- The release action is split to ROW-119. Reason: Rowbly has no release action for a Thread, so it needs a new factory command, and this Story is already large.
- The drop of inbound updates is left to ROW-98, with a predicate from this Story. Reason: inbound updates do not exist yet (ROW-98 is in refinement).
- Only entries with a `seq` greater than the `appliedSeq` of the note are held. Entries that the main machine applied before the cancel stay applied. Reason: the Spec says "each outbox entry of the Thread that is not applied becomes held".
- `--apply` keeps an entry with a conflict in the held folder and removes the other entries. Reason: then a second apply has no new effect and the user does not lose a change. The resume gate then needs a discard.
- The attention entry is set when a hold adds entries, and the dismiss removes only the entry. Reason: the Spec says that a dismiss does not remove the held entries.
- `rowbly thread held` runs without the factory. Reason: the held files are on the main machine and the apply needs only the Project write lock.

## Review findings

The code satisfies the acceptance criteria. Local `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass, and CI passes on `a73aa963`. The earlier finding (conflicts with `d6b2ea8f`) is repaired.

Blocking findings:

1. The pull request has merge conflicts with `origin/main` (`98223572`, the merge of ROW-98, pull request #299). GitHub refuses the merge. These files have conflicts:
   - `CHANGELOG.md`
   - `docs/architecture/native-factory/README.md`
   - `docs/architecture/native-factory/runtime-and-locks.md`
   - `src/services/factory-manager/remote-dispatch.ts`
   - `src/services/pi-runtime/import-boundary.test.ts`
   - `src/services/remote-executor/remote-reconnect.ts`
   - `src/services/remote-executor/remote-sync.ts`

   Fix: merge `origin/main` into `story/ROW-99`. Keep the inbound update steps of ROW-98 and the abandoned Thread steps of this Story in `remote-reconnect.ts`, `remote-sync.ts` and `remote-dispatch.ts`. Keep the `(ROW-99)` line in the `### Pre Release` section of `CHANGELOG.md`. Then make sure that `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

Non-blocking notes (also in a comment on the pull request):

- `abandonedHolds` and `pendingAbandoned` read all worker Threads at each sync. This can become slow with many Threads.
- A resume removes the `abandoned` note and `remoteOutcome`. The documentation can say this.
