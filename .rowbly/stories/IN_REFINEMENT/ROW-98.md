---
title: Send board changes to running remote Threads
stage: IN_REFINEMENT
position: 17
uid: 5e3e621e-900b-402f-bc40-4ac20d145759
dependsOn:
  - ROW-94
  - ROW-97
createdAt: 2026-11-16T19:45:11.252Z
updatedAt: 2026-11-16T20:06:57.191Z
worktree: null
pull_request: null
---

## Goal

Changes on the main machine reach the copy of each running remote Thread.

Read the Spec `remote-worker-hosts`, section "The copy and inbound updates".

## Scope

In scope:

- At each scan, compare the canonical files with the base of each remote Thread. Make inbound updates with `before` and `after` values. Then the base becomes the current values.
- Story field changes, new Stories, deleted Stories, new and removed attachments (through the PNG cache), and config and Stage prompt files.
- The host applies each field change as a compare-and-set against the copy. A field that the worker changed keeps the value of the worker.
- Inbound updates have their own `seq` numbers and acknowledgements. They wait in the queue of the host while it is offline.
- Share the compare-and-set code with the outbox apply.

Not in scope:

- A message to the worker about an update.

## Acceptance criteria

- An update that arrives two times has one effect.
- Tests cover each type of update, a field that the worker changed and a disconnect.
