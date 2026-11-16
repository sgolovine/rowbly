---
title: Record attachment writes in the outbox
stage: IN_REFINEMENT
position: 10
dependsOn:
  - ROW-90
createdAt: 2026-11-16T19:45:07.000Z
updatedAt: 2026-11-16T20:06:53.538Z
worktree: null
pull_request: null
---

## Goal

Attachment writes of a remote worker go into the outbox with their PNG files.

Read the Spec `remote-worker-hosts`, section "The outbox".

## Scope

In scope:

- `addAttachment` accepts an id that the caller gives. Without an id, it makes a new id, as now.
- With the recorder on, an add writes the PNG to `outbox/blobs/<sha256>.png` first, then the entry `attachment.add` with the attachment record and the `sha256`.
- With the recorder on, a remove writes the entry `attachment.remove` with the id and the `sha256`.
- A hidden command `rowbly host blob <sha256>` writes the raw bytes of one outbox PNG to stdout. It accepts only a hex hash.
- A cache of PNG files by attachment id on the host, for the copies of the Threads.

Not in scope:

- The apply on the main machine.

## Acceptance criteria

- An entry never points to a missing PNG, also after a crash between the two writes.
- `host blob` refuses a value that is not a hex hash and a path outside the blob folder.
- Tests cover add, remove, the given id and the blob command.
