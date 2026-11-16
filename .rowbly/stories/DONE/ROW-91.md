---
title: Record attachment writes in the outbox
stage: DONE
position: 10
uid: b4e31257-5ff9-489d-8a98-635e5a691ffe
dependsOn:
  - ROW-90
createdAt: 2026-11-16T19:45:07.000Z
updatedAt: 2026-11-16T21:07:28.838Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-91
pull_request: https://github.com/sgolovine/rowbly/pull/275
---

## Goal

A remote worker can add and remove attachments. Each attachment write of a remote worker goes into the outbox with its PNG file. Then the main machine can apply it later (ROW-94).

Read the Spec `remote-worker-hosts`, sections "The outbox" and "The copy and inbound updates".

## Scope

In scope:

- `addAttachment` accepts an optional `id` from the caller. Without an `id`, it makes a new id, as now. ROW-94 uses the given id on the main machine.
- With the recorder on, `addAttachment` writes the PNG to `$ROWBLY_OUTBOX/blobs/<sha256>.png`, then the entry `attachment.add` with the attachment record and the `sha256`. This replaces the ROW-90 refusal of `addAttachment`.
- With the recorder on, `removeAttachment` writes the entry `attachment.remove` with the id and the `sha256` of the removed PNG. This replaces the ROW-90 refusal of `removeAttachment`.
- A hidden command `rowbly host blob <sha256>` writes the raw bytes of one outbox PNG to stdout. It accepts only a hex hash.
- A cache service of PNG files by attachment id, in a folder that the caller gives. The host agent uses it for the copies of the Threads (ROW-92).

Not in scope:

- The apply of the entries on the main machine, and the removal of acknowledged entries and their PNG files (ROW-94).
- The host agent, its runtime folder and the place of the cache folder on the host (ROW-89, ROW-92).
- The copy of the PNG files into a Thread copy, and the fetch of a missing PNG from the main machine (ROW-92).
- The removal of PNG files in `blobs/` that no entry points to.
- `updateStory` with `attachments` under a recorder. It stays refused.
- A CLI option for the given id.

## Acceptance criteria

- [ ] `addAttachment({ story, file, id })` without a recorder adds the attachment with that id. The manifest and the PNG file name use the id. A test examines it.
- [ ] `addAttachment` with an id that is not a valid attachment id gives a `ValidationError`. An id that is already in the manifest of the Story gives a `ConflictError`. Both write no file. A test examines both.
- [ ] `addAttachment` without an id and without a recorder behaves as before. The existing tests pass.
- [ ] With a recorder, `addAttachment` adds the attachment to the Project (the copy) and records one entry `{ seq, opId, threadId, storyId, type: "attachment.add", attachment: { id, name, type, size, createdAt }, sha256 }`. `sha256` is the lowercase hex SHA-256 of the PNG bytes. A test examines it.
- [ ] With the file recorder, `$ROWBLY_OUTBOX/blobs/<sha256>.png` exists, is durable and has the same bytes before the entry is appended to `outbox.jsonl`. A test makes the entry append fail after the blob write and examines that the PNG is in `blobs/`. A test also examines that no entry exists without its PNG.
- [ ] Two adds of the same PNG bytes give one blob file and two entries. A test examines it.
- [ ] With a recorder, `removeAttachment` removes the attachment from the copy and records one entry `{ seq, opId, threadId, storyId, type: "attachment.remove", id, sha256 }`. A test examines it.
- [ ] Field entries of ROW-90 do not change.
- [ ] With a recorder, `updateStory` with `attachments` still gives the ROW-90 `ConflictError`. The existing test passes.
- [ ] `rowbly host blob <sha256>` with `ROWBLY_OUTBOX` set writes the exact bytes of `$ROWBLY_OUTBOX/blobs/<sha256>.png` to stdout and exits with 0. A CLI test compares the bytes.
- [ ] `rowbly host blob` gives a `VALIDATION` error and writes nothing to stdout for a value that is not 64 lowercase hex characters, for example `../x`, `ABC…`, a 63-character value or a value with `/`. A test examines each.
- [ ] `rowbly host blob` refuses a blob path that is a symlink, or that resolves outside `$ROWBLY_OUTBOX/blobs/`. A test examines a symlink.
- [ ] `rowbly host blob` for a hash without a file gives a `NOT_FOUND` error. Without `ROWBLY_OUTBOX`, it gives a `VALIDATION` error. A test examines both.
- [ ] `host blob` does not show in `rowbly host --help`. The test of `register-commands` agrees.
- [ ] The cache service puts a PNG by attachment id, reads it, tells if an id is there, and gives the ids of a list that are not there. It refuses an invalid id and bytes that are not a PNG or are larger than 10 MiB. A put of an id that is already there keeps the first file. Tests cover each function.
- [ ] The services do not print, prompt, exit or read `process.env`. The outbox and cache modules do not load Pi. `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Outbox code: `src/services/outbox/outbox.ts` (the `WriteRecorder` interface, entry types, `recordStoryWrite`, `refuseRemoteWrite`) and `src/services/outbox/outbox-file.ts` (`appendOutboxEntry`, `fileRecorder`, `outboxPaths`). Tests: `outbox.test.ts`.
- Extend `WriteRecorder` with the attachment writes, for example `recordAttachmentAdd({ storyId, attachment, bytes })` and `recordAttachmentRemove({ storyId, id, sha256 })`. Or make `record` take a union of write types. The file recorder calculates `sha256`, writes the blob, then appends the entry under the outbox lock.
- Add `blobsDir` (`<dir>/blobs`) to `outboxPaths`. Write a blob through a temporary file in `blobs/`, `fsync`, rename to `<sha256>.png`, then sync the folder. Use `writeFileAtomic(..., { durable: true })` of `src/services/files/files.ts` if it fits. If `<sha256>.png` already exists, keep it (the content is the same).
- Order in `addAttachment` with a recorder: the service writes the copy first (`withAttachments` and `touchStory`), then it records. The recorder writes the blob first, then the entry. Thus an entry never points to a missing PNG. A crash after the blob write leaves only a PNG without an entry.
- `withAttachments` in `src/services/attachment-files/attachment-files.ts` makes the ids with `randomUUID()`. Let it take optional ids for the images. Check the given id with `validateAttachmentId`, and check that the manifest does not already have it, before the first write.
- `removeAttachment`: calculate the `sha256` from the PNG bytes in the copy before the rename. Record the entry after the remove succeeds.
- Remove the `refuseRemoteWrite` calls from `addAttachment` and `removeAttachment` in `src/services/attachment/attachment.ts`. Keep the call in `updateStory` (`src/services/story/story.ts`).
- The `host blob` command goes in `src/commands/host/host.ts`. Register it with `{ hidden: true }`. Put the logic in a service function, for example `readOutboxBlob({ dir, sha256 })` in `outbox-file.ts`: check `/^[0-9a-f]{64}$/`, use `noSymlink` (or `lstat`) on the `blobs` folder and the file, check that the resolved path is in `blobs/`, and read the bytes. The command reads `ROWBLY_OUTBOX` and writes the bytes with `process.stdout.write`. The command must not require `ROWBLY_THREAD_ID`, so it does not use `commandContext` of `src/commands/output/outbox-env.ts` for this check. Errors use the usual error output, also with `--json`.
- The cache service goes in a new folder `src/services/attachment-cache/` (`attachment-cache.ts` and `attachment-cache.test.ts`). Each function takes the cache folder from the caller. Files are `<dir>/<attachment-id>.png`. Use `validateAttachmentId` and the PNG checks of `attachment-files.ts` (export `validatePng` if necessary). Writes are atomic.
- Update `docs/architecture/storage.md` (section "Outbox of a remote worker": `blobs/`, the attachment entry shapes and the order of the writes) and `docs/architecture/cli.md` (the hidden `host blob` command). Write them in STE.

## Assumptions

- Attachment entries have a `type` key (`attachment.add` or `attachment.remove`). Field entries of ROW-90 stay without `type`. Reason: the Spec example of a field entry has no `type`, and ROW-94 can tell the kinds apart by the key.
- `rowbly host blob` finds the outbox folder from `ROWBLY_OUTBOX` in its environment. Reason: the Spec gives a fixed command with only the hash, and the data must not go in the arguments. ROW-89 and ROW-94 set the environment of the remote command.
- The cache folder is a parameter of the cache service. Reason: ROW-89 makes the runtime folder of the host, and it is not on the base branch yet.
- The given id is a service option only, not a CLI option. Reason: only ROW-94 uses it, and it calls the service.
- `updateStory` with `attachments` stays refused under a recorder. Reason: only the TUI uses it, and a remote worker uses the CLI. This keeps the scope small.
- The blob is written before the entry and after the copy write. Reason: the acceptance criterion needs a PNG for each entry, and ROW-90 records after the copy write.
- Blob files without an entry are not removed in this Story. Reason: they are harmless, and the host agent and ROW-94 own the cleanup.
