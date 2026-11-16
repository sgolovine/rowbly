---
title: Record canonical writes in an outbox
stage: IN_REFINEMENT
position: 9
createdAt: 2026-11-16T19:45:06.450Z
updatedAt: 2026-11-16T20:22:33.889Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-90
pull_request: null
---

## Goal

The services can record each canonical write as an outbox entry. A remote worker uses this record.

Read the Spec `remote-worker-hosts`, section "The outbox".

## Scope

In scope:

- A write recorder in `ServiceContext`. When it is set, each Story write records one entry. The entry has the field changes with `before` and `after` values: Story fields and Stage moves.
- Derived values (`updatedAt`, `position`) are not in an entry.
- The CLI turns on the recorder when an outbox setting is in its environment. It adds the entries to `outbox.jsonl` with a `seq` number. Each entry is durable before the command returns.
- With the recorder on, the services refuse a new Story, Stage or Spec and each config change. The error tells the worker that remote workers cannot do this.

Not in scope:

- Attachments. Another Story adds them.
- The apply of the entries on the main machine.

## Acceptance criteria

- The services do not print, prompt or exit. The front ends stay thin.
- Tests cover each type of write, the refused writes and the `seq` order.
