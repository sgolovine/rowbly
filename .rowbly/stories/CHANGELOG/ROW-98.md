---
title: Send board changes to running remote Threads
stage: CHANGELOG
position: 17
uid: 5e3e621e-900b-402f-bc40-4ac20d145759
dependsOn:
  - ROW-94
  - ROW-97
createdAt: 2026-11-16T19:45:11.252Z
updatedAt: 2026-11-17T00:18:09.050Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-98
pull_request: https://github.com/sgolovine/rowbly/pull/299
---

## Goal

A remote worker works on a copy of the canonical `.rowbly/` files (ROW-96). Today the copy does not change after the launch. Thus a remote worker does not see a change that the user or the supervisor makes on the main machine while the worker runs, for example a new Story, a changed description or a new Stage prompt.

After this Story, each change of the canonical files on the main machine goes to the copy of each running remote Thread as an inbound update. A change that the worker made in its copy is not overwritten.

Read the Spec `remote-worker-hosts`, section "The copy and inbound updates".

## Scope

In scope:

- **Diff at each scan.** At each scan, for each open remote run that has a base (`runtime/hosts/<host>/threads/<thread-id>/base.json`, written by `writeCopyBase` after `prepare`), compare the current canonical files with the base. Each difference becomes an inbound update. The update goes in the durable inbound queue of the Thread first. Then the base becomes the current values (a new `base.json`).
- **Update types** (version 1):
  - `story.update`: `{ storyId, storyUid?, changes: FieldChange[] }`. The changes are the same paths and value forms as an outbox field entry (`title`, `description`, `stage`, `fields.<key>`, `tags`, `dependsOn`), with `before` and `after`. Calculate them with `storyChanges()` of `src/services/outbox/outbox.ts` from the base Story file and the canonical Story file.
  - `story.create`: `{ storyId, path, content }`. A Story that is in the canonical files and not in the base.
  - `story.delete`: `{ storyId }`. A Story that is in the base and not in the canonical files.
  - `attachment.add`: `{ storyId, attachment, file? }`. A record that is in the canonical manifest of a Story and not in the base manifest. When the Story is the Story of the Thread or one of its upstream Stories (the same rule as `buildThreadCopy`), the main machine first uploads the file to the attachment cache of the host (`cacheMissing`, then `cachePut`) and sets `file`. For other Stories, only the record goes. The worker gets that file through the existing attachment fetch.
  - `attachment.remove`: `{ storyId, id }`. A record that is in the base manifest and not in the canonical manifest.
  - `file.put`: `{ path, content }` and `file.delete`: `{ path }`. Each other text file of the copy: `rowbly.config.json`, `stages/*.md`, `prompts/*.md`, `specs/*.md` and `.gitignore`. The host replaces or removes the full file.
- **Apply on the host.** A new service on the host applies the updates of one Thread to its copy (`threads/<thread-id>/copy/`) in `seq` order:
  - `story.update`: a compare-and-set of each change against the copy, with the same code as the outbox apply. A value equal to `before` gets `after`. A value equal to `after` is skipped. Each other value is a conflict: the value of the worker stays in the copy, and the update records nothing else. A Story that is not in the copy skips the update.
  - `story.create`: writes the Story file when the copy has no Story with that ID. Else skip.
  - `story.delete`: removes the Story file (and its attachment folder) from the copy. A missing Story is skipped.
  - `attachment.add`: adds the record to the manifest of the copy when the id is not there, and writes the file from the cache of the host when `file` is set. An id that is already there is skipped.
  - `attachment.remove`: removes the record and its file from the copy. A missing id is skipped.
  - `file.put` and `file.delete`: replace or remove the file. Check each path with `validateCopyPath`.
  - The apply writes no outbox entry. It holds the `flock` file of the worker command prefix (`threadPaths(paths, threadId).lock`) through `withFileLock`, so that a worker write and an inbound update do not run at the same time.
- **Sequence numbers and acknowledgements.** Inbound updates have their own `seq` for each Thread, separate from the outbox `seq`. The host records the last applied `seq` of each Thread durably after each update. An update with a `seq` equal to or less than that value is skipped. The answer of the host is the last applied `seq`. That answer is the acknowledgement: the main machine then removes the updates with that `seq` or less from its queue.
- **The queue.** The updates of a Thread wait in the queue while the host is offline. On reconnect (`reconnectHost` in `src/services/remote-executor/remote-reconnect.ts`), the inbound updates go after the queued commands (`sendQueued`) and before the channel opens again and the outbox sync.
- **Shared compare-and-set.** Move the decision code of `src/services/outbox-apply/apply-fields.ts` (`decide`, `hasWritableForm`, `updateInput`) to a shared module next to `outbox-compare.ts`. The outbox apply and the inbound apply both use it. The outbox apply keeps its behaviour.
- Documentation in STE: the inbound updates, the queue file and the host files in `docs/architecture/native-factory/host-agent.md` and the executor section of `docs/architecture/native-factory/README.md`, the queue file in the file tree of `runtime-and-locks.md`, and the new hidden command in `docs/architecture/cli.md`.

Not in scope:

- A message to the worker about an update.
- The drop of the updates of an abandoned Thread (ROW-99).
- The recovery of the queue after a restart of the daemon (ROW-117).
- End-to-end daemon tests of an inbound update (ROW-104).
- The TUI.

## Acceptance criteria

- [ ] A test of the diff gives the correct update for each type: a changed field of a Story (each path), a new Story, a deleted Story, a new attachment, a removed attachment, a changed config file, a changed Stage prompt file and a removed file. After the diff, the base has the current values, and a second diff with no change gives no update.
- [ ] A test of the host apply applies each update type to a copy and examines the files of the copy.
- [ ] A test changes a field in the copy (as the worker), then applies a `story.update` for the same field with a different value. The copy keeps the value of the worker. A change of a different field of the same Story is written.
- [ ] A test applies the same updates two times. The second time has no effect, and the answer gives the same last applied `seq`.
- [ ] A test of the host apply proves that it writes no outbox entry and that it holds the Thread `flock` file.
- [ ] A test with the fake transport (`createFakeHostTransport`) disconnects the host, makes a canonical change, and examines that the update stays in the queue file. After `reconnect()`, the host gets the queued stop or cancel commands first, then the inbound updates, and the queue is empty after the acknowledgement.
- [ ] A test loses the answer of the inbound send (the host applied the updates but the main machine did not get the answer). The next send gives the same updates again, and each has one effect.
- [ ] A test of `attachment.add` for the Story of the Thread examines that the file goes through the cache of the host (`cache-put` only for a missing id) and is in the copy.
- [ ] The outbox apply tests pass with no change of expectations after the move of the shared code.
- [ ] A local factory without worker hosts works as before. The existing factory manager tests pass.
- [ ] The new modules do not load Pi. Add them to `src/services/pi-runtime/import-boundary.test.ts`. No test uses real SSH or live credentials.
- [ ] The new hidden command is in the list of hidden actions of `src/commands/register-commands/register-commands.test.ts`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- **Base branch.** At the time of refinement, the worktree is on a detached `HEAD` (`1a4e9fb6`) without the merge of ROW-97 (PR #296, `08369fdb` on `origin/main`). Make the branch `story/ROW-98`, then merge `origin/main` first, so that `host-command-queue.ts`, `remote-commands.ts`, `remote-reconnect.ts`, `remote-sync.ts` and `remote-heartbeat.ts` exist.
- **Base.** `writeCopyBase` in `src/services/outbox-apply/host-files.ts` writes the base of a Thread (`CopyBase`: `files` and `attachments`). The base has the full text of each copy file, also the Story files and the attachment manifests (`attachments/<story-id>/manifest.json`). Use `buildThreadCopy` (`src/services/thread-copy/thread-copy.ts`) to read the current canonical files in the same form. A Story is identified by its ID (the file name), not by its path, because a Stage move changes the path. Parse a Story file with the Markdown parser of `src/services/markdown/`, and get the field keys from the config.
- **Inbound queue file.** Write `runtime/hosts/<host>/threads/<thread-id>/inbound.json` with `writeFileAtomic(..., { mode: 0o600, durable: true })` through `preparedHostDir` and `runtimeChild`, as `writeCopyBase` does. Content: `{ version: 1, nextSeq, updates: [{ seq, type, ...body }] }`. Write the queue before the new base. A crash between the two writes makes the same updates again with new `seq` values, and the compare-and-set and the skip rules give them no effect.
- **Seq across runs.** A new `prepare` of the same Thread (a resume) sends a new full copy. At `writeBase` in `startRemote`, remove the waiting updates of the Thread but keep `nextSeq`, so that the `seq` values on the host only increase. When a run closes, remove its waiting updates.
- **The host command.** Add a hidden request command `rowbly host inbound <project-id>` in `src/commands/host/host-run-commands.ts`. Input on stdin: `{ threadId, updates }`, with the limit `HOST_PREPARE_LIMIT`. Answer: `{ threadId, appliedSeq }`. Use `runWithoutContext`, as the other host run commands do, so that no outbox context is made. Add the call to `src/services/remote-executor/remote-calls.ts`. A Thread that is not prepared on the host gives a `NotFoundError`; the main machine then removes the waiting updates of that Thread.
- **Host files.** The host keeps the last applied `seq` in `agent/threads/<thread-id>/inbound-applied.json` (`{ "seq": <n> }`, mode 0600, `durable: true`). A missing file gives `0`.
- **Where the send runs.** In `syncHosts` (`remote-sync.ts`), after the outbox sync of a host: the diff, then the send of the waiting updates of each open run. The diff reads the canonical files under the Project write lock, through the same input path as the outbox `sync` (for example a new `RemoteExecutorInput` function that the manager gives). It does not take the state lock. A transport error keeps the updates in the queue without a problem entry; the heartbeat and `reconnectHost` send them later. A refusal of the host (`HostProtocolError`) keeps the updates and gives the problem of the host, so that `withSyncAttention` sets `host-sync:<host>`.
- **Order of the outbox and the diff.** Apply the outbox before the diff. Then a change of the worker that is already on the main machine gives an update whose `after` equals the copy value, and the host skips it.
- **Attachments.** Use the manifest functions of `src/services/attachment-files/` on the copy root. Do not call `addAttachment` on the host, because it needs the bytes and can record. The cache read on the host is `readCachedAttachment`.
- **Safety.** Never take the Project write lock while you hold the state lock. Do not load Pi in the remote executor or the host apply. Services do not import `commander`, `ink` or `react`, and do not print. Follow the `rowbly-code-style` skill. Use `.js` extensions in relative imports.

## Assumptions

- The inbound `seq` is for each Thread, not for each host. Reason: the base and the copy are for each Thread, and the host applies the updates to one copy. The Spec asks only for "their own sequence numbers".
- The acknowledgement is the answer of the `rowbly host inbound` request (the last applied `seq`), not a separate command. Reason: the host applies the updates in the request, so the answer can tell the applied `seq`. A lost answer gives a second send with one effect.
- The inbound queue is a separate file for each Thread, not a new entry type of `commands.json`. Reason: `commands.json` holds small commands with request ids, and its order rule (stop and cancel first) does not apply to updates. The send order on reconnect (after the queued commands) is the order of ROW-97.
- A conflict on the host keeps the value of the worker and gives no attention entry. Reason: the Spec says only that the value of the worker stays. The outbox apply on the main machine already gives an attention entry for a real conflict of the two sides.
- All non-Story text files of the copy (config, Stage prompts, user prompts, Specs, `.gitignore`) are replaced as full files. Reason: the copy contains them, and one rule for each file is smaller than a rule for each file type.
- The file of a new attachment goes to the host only for the Story of the Thread and its upstream Stories. Reason: `buildThreadCopy` uses the same rule, and the worker can fetch other files on demand.
- The host apply holds the Thread `flock` file of the worker command prefix. Reason: each worker write holds the same file, so the two cannot change the copy at the same time.
