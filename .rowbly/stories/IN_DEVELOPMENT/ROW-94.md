---
title: Apply outbox entries on the main machine
stage: IN_DEVELOPMENT
position: 13
dependsOn:
  - ROW-85
  - ROW-90
  - ROW-91
createdAt: 2026-11-16T19:45:08.648Z
updatedAt: 2026-11-16T21:22:03.014Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-94
pull_request: https://github.com/sgolovine/rowbly/pull/278
---

## Goal

A remote worker writes its canonical changes to the outbox of its worker host (ROW-90, ROW-91). The main machine must apply these entries to the board. Then the changes of remote workers get to the canonical `.rowbly/` files, and the next scan commits them.

Read the Spec `remote-worker-hosts`, section "The outbox" (subsections "Record" and "Apply").

## Scope

In scope:

- **Compare-and-set of one field change.** A pure function that compares the value on the main machine with `before` and `after` of a `FieldChange`:
  - equal to `before`: write `after`;
  - equal to `after`: skip (already applied);
  - another value: conflict, do not write.
  - Use `isDeepStrictEqual` and the same value forms as `recordedValues()` in `src/services/outbox/outbox.ts` (`null` for a missing value, full lists for `tags` and `dependsOn`, the body for `description`). Export it so that ROW-98 (inbound updates) can use the same code.
- **The apply of a list of entries** for one host, in `seq` order (main machine service, for example `src/services/outbox-apply/outbox-apply.ts`):
  - A field entry: read the Story, run the compare-and-set for each change, then call `updateStory` one time with the changes to write. A missing Story makes each change a conflict.
  - `attachment.add`: if the Story has an attachment with the same id and the same `sha256` of the PNG, skip. If the Story is missing, or has the id with a different hash, it is a conflict. Else get the PNG from the source, examine it (see below), then call `addAttachment({ story, image: { name, bytes }, id })` with the id and the name of the entry.
  - `attachment.remove`: remove the attachment with `removeAttachment` when it is on the Story. Skip it when it is not there (also when the Story is missing).
  - A bad PNG (the hash is not equal to `sha256`, the size is more than `MAX_ATTACHMENT_BYTES` (10 MiB), or the bytes are not a PNG) is a conflict. Do not add the attachment.
  - An entry with `seq` equal to or less than the last applied `seq` of the host is skipped. Thus an entry that arrives two times has one effect.
  - An entry with an unknown `type`, or a bad shape, is a conflict. The apply continues with the next entry.
  - A field entry with some conflicting changes writes the changes that do not conflict, and records the conflicting changes.
- **The PNG of a conflict** stays for recovery: write it to `runtime/hosts/<host>/conflicts/<sha256>.png` (mode 0700 folders, through `runtimePath`/`runtimeChild`).
- **The applied `seq` record** in `runtime/hosts/<host>/outbox-applied.json`: `{ "seq": <n> }`. Write it with `writeFileAtomic(..., { durable: true })` after each entry, before the next entry. Read `0` when the file is missing.
- **Locks.** The apply holds the Project write lock (`projectWrite`) and does not take the state lock. The attention entries are set after the Project write lock is free.
- **The source of the entries.** An interface `OutboxSource` with `entriesAfter(seq)`, `blob(sha256)` and `acknowledge(seq)`. A transport implementation that uses `HostTransport` (ROW-85) with fixed remote commands:
  - `request([<rowbly>, "host", "outbox"], { afterSeq })` gives `{ entries: OutboxEntry[] }`, the entries with `seq` greater than `afterSeq`, in `seq` order.
  - `bytes([<rowbly>, "host", "blob", <sha256>], null, { limit: MAX_ATTACHMENT_BYTES + 1 })` gives the PNG (the command of ROW-91).
  - `request([<rowbly>, "host", "outbox-ack"], { seq })` tells the host to remove the acknowledged entries.
  - The remote `<rowbly>` path is an argument of the source (the caller gives it).
- **The host side of the read and the acknowledgement**, in `src/services/outbox/outbox-file.ts`:
  - `readOutboxEntries(dir, afterSeq)`: the complete entries with `seq` greater than `afterSeq`. A line that is not complete JSON (a crash during an append) is ignored.
  - `acknowledgeOutbox(dir, seq)`: under the outbox lock, removes the lines with `seq` equal to or less than `seq`, keeps the `seq` file, and removes each PNG in `blobs/` that no remaining `attachment.add` entry points to.
  - Hidden commands `rowbly host outbox` and `rowbly host outbox-ack` in `src/commands/host/host.ts`. They read the JSON input on stdin and the folder from `ROWBLY_OUTBOX`, the same as `rowbly host blob`. `--json` output through `run()`.
- **One sync function** for the main machine: read the last applied `seq`, get `entriesAfter(seq)`, apply them under the Project write lock, then call `acknowledge(lastAppliedSeq)` only when the record is on the disk. The caller gives the entries of the live channel to the same apply function. The function gives the conflicts.
- **Attention.** A function in `src/services/factory-manager/` that runs the sync for one host and then sets one attention entry for each Story with a conflict, key `outbox:<storyId>`, with `withEntry`. The text has the host, the `seq`, the path (or the attachment id) and the `before`, `after` and current values (long values cut to 200 characters).
- The next scan commits the changes with the usual canonical commit. This Story adds no commit.
- Tests next to each new or changed service. Documentation in STE: the apply rules, the `runtime/hosts/<host>/` files and the two hidden commands, in `docs/architecture/storage.md` and `docs/architecture/cli.md`.

Not in scope:

- Held entries of abandoned Threads (ROW-99).
- The host agent and the frames of the `rowbly host attach` channel (ROW-89, ROW-92).
- The call of the sync from the manager loop, the `RemoteExecutor`, the apply before a remote Thread completes, and `waiting for host sync` (ROW-96).
- The reconnect order, the heartbeat and the host queue (ROW-97).
- Inbound updates to the host (ROW-98).
- The TUI.

## Acceptance criteria

- [ ] A test applies a field entry for each path (`title`, `description`, `stage`, `fields.<key>`, `tags`, `dependsOn`) where the value is equal to `before`, and the Story gets `after`.
- [ ] A test applies a change whose value is already equal to `after`. Nothing is written and no conflict is given.
- [ ] A test applies a change whose value is a third value. The Story keeps its value, the result has one conflict, and the attention entry `outbox:<storyId>` has the path and the three values.
- [ ] A test applies a field entry for a Story that does not exist. Each change is a conflict.
- [ ] A test applies `attachment.add` with a good PNG. The Story has the attachment with the id and the name of the entry, and the PNG bytes are equal.
- [ ] Tests apply `attachment.add` with a hash that is not equal, with more than 10 MiB, and with bytes that are not a PNG. Each gives a conflict, adds no attachment, and keeps the PNG in `runtime/hosts/<host>/conflicts/`.
- [ ] A test applies `attachment.add` for an id that is already on the Story with the same hash (skip), and with a different hash (conflict).
- [ ] A test applies `attachment.remove` for an attachment that is there (removed) and for one that is not there (skipped, no conflict).
- [ ] A test gives the same entries two times. The second time has no effect and no conflict.
- [ ] A test makes the acknowledgement fail after the apply (a crash between the apply and the acknowledgement). A second sync applies no entry two times and then sends the acknowledgement.
- [ ] A test proves the order of the locks: the apply holds the Project write lock and not the state lock.
- [ ] Tests for `readOutboxEntries` and `acknowledgeOutbox`: entries after a `seq`, a broken last line, removed lines, a kept `seq` file and removed PNG files.
- [ ] Tests use the fake transport of ROW-85. No test uses real SSH. The new modules do not load Pi (add them to `src/services/pi-runtime/import-boundary.test.ts`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- **Base branch.** The ROW-91 merge (`68350a70`, PR #275) is on `origin/main`, but it was not on the base of the worktree at the time of refinement. Merge `origin/main` into the Story branch before you start. ROW-91 adds `addAttachment({ id })`, the `attachment.add` and `attachment.remove` entries, `writeOutboxBlob`, `readOutboxBlob` and `rowbly host blob`.
- Entry types: `OutboxEntry`, `EntryBody` and `FieldChange` in `src/services/outbox/outbox.ts`. The files of an outbox folder: `outboxPaths()` in `src/services/outbox/outbox-file.ts`.
- Story writes: `updateStory` and `getStory` in `src/services/story/`. Attachments: `addAttachment`, `removeAttachment` and `listAttachments` in `src/services/attachment/attachment.ts`, `MAX_ATTACHMENT_BYTES` and `prepareImages` in `src/services/attachment-files/attachment-files.ts`.
- The apply runs without a recorder in its `ServiceContext`. Else the services refuse or record the writes.
- Lock pattern: see `pullUpstreamStories` in `src/services/factory-manager/upstream-pull-step.ts` (`serial(manager, () => projectWrite(root, ...))`, no state lock). Attention entries: `withEntry` as in `supervisor-steps.ts`. An attention key has 1 to 128 characters.
- Runtime paths: `runtimePath`, `checkRuntimeDir` and `runtimeChild` in `src/services/runtime-files/runtime-files.ts`. `runtime/` is never committed.
- Transport: `HostTransport` in `src/services/host-transport/host-transport.ts`. A non-zero exit code of a remote command is a result, not a transport failure: give a clear `RowblyError` with the `stderr` text.
- The PNG check: the first 8 bytes are the PNG signature (`89 50 4E 47 0D 0A 1A 0A`). Use the existing check of `prepareImages` if it has one.
- Services do not import `commander`, `ink` or `react`, and do not print. Follow the `rowbly-code-style` skill.

## Assumptions

- The work stops at a sync function and an attention step. ROW-96 and ROW-97 call them from the manager and on reconnect. Reason: the host agent and its channel (ROW-89, ROW-92) are not done, and ROW-96 and ROW-97 own the manager and the reconnect.
- The host gives the missing entries through a hidden request command `rowbly host outbox`, and takes the acknowledgement through `rowbly host outbox-ack`. Both use `ROWBLY_OUTBOX`, as `rowbly host blob` does. Reason: this is the smallest change that agrees with the transport and with the command of ROW-91. The host agent can use the same file functions on its channel.
- The compare-and-set applies to each change, not to the full entry. The changes of an entry that do not conflict are written. Reason: the table in the Spec is for each field change.
- The applied `seq` record is written after each entry, not only at the end of a batch. Reason: a crash then applies at most one entry again, and the compare-and-set makes that entry have no effect.
- The applied `seq` advances past an entry with a conflict. Reason: the attention entry tells the user, and a retry gives the same conflict again.
- One applied `seq` for each host and Project (one outbox folder for each host and Project). Reason: the Spec records "the last applied `seq` for each host", and the entries have `threadId` for the Thread.
- `createdAt` of an added attachment is the time of the apply on the main machine. Reason: `addAttachment` sets it, and the Spec permits derived values to be calculated again.
- A conflict PNG goes to `runtime/hosts/<host>/conflicts/<sha256>.png`. Reason: the Story says "stays in `runtime/hosts/<host>/`" and gives no exact name.
- An attention entry for each Story (`outbox:<storyId>`), and a new conflict replaces the text of the entry. Reason: the key in the Story is `outbox:ROW-5`.
- (Development) The recorder now holds the outbox lock while it writes the PNG and adds the `attachment.add` entry. Reason: else an acknowledgement between the two writes can remove the new PNG, because no entry points to it yet.
- (Development) The hidden host commands use a new `runWithoutContext` output helper. Reason: `run()` makes an outbox context, and that context needs `ROWBLY_THREAD_ID` when `ROWBLY_OUTBOX` is set.
- (Development) A failure of the connection (unreachable, authentication, time limit, version) during a PNG fetch stops the apply without a record of the entry. The next sync tries it again. A different failure of the fetch, for example a missing blob or a PNG larger than the transport limit, is a conflict without a kept PNG.
- (Development) An entry without a valid `seq` or Story ID is a conflict and does not advance the applied `seq`. Its attention key is `outbox:<host>`.
- (Development) A failed acknowledgement with a `RowblyError` is given as `acknowledgeProblem` in the result, so that the conflicts of the apply still get attention entries. Each other error is thrown.
- (Development) An unknown path, a `fields.<key>` that the config does not have, or a new value with a bad form (for example a `title` that is not text) is a conflict. A write that `updateStory` refuses makes each change of that write a conflict.
