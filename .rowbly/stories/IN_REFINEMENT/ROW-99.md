---
title: Hold the changes of abandoned remote Threads
stage: IN_REFINEMENT
position: 18
dependsOn:
  - ROW-94
  - ROW-97
createdAt: 2026-11-16T19:45:12.293Z
updatedAt: 2026-11-16T20:06:57.706Z
worktree: null
pull_request: null
---

## Goal

When the user cancels or releases a remote Thread while its host is offline, the late changes of that Thread never go to the board automatically.

Read the Spec `remote-worker-hosts`, section "Abandoned Threads".

## Scope

In scope:

- The Thread becomes `cancelled` with an `abandoned` note: the time, the reason (cancel or release) and the last applied `seq`.
- A stop for the Thread goes into the queue of the host. On reconnect, it goes first.
- The Story does not wait on `waiting for host sync` for this Thread.
- On reconnect, each outbox entry of the Thread that is not applied is held. The main machine moves the held entries and their PNG files to `runtime/hosts/<host>/held/<threadId>/`, then sends the acknowledgement.
- The final result of the worker goes to `remoteOutcome`.
- One attention entry for each Thread, with the key `abandoned:<threadId>` and a summary of the held changes. A dismiss does not remove the held entries.
- `rowbly thread held <id>` lists the held entries. `--apply` applies them with the compare-and-set. `--discard` deletes them. With `--json`.
- Inbound updates for an abandoned Thread are dropped.
- A resume of an abandoned Thread needs the held entries applied or discarded, and a connected host.

Not in scope:

- The TUI key. The TUI Story adds it.

## Acceptance criteria

- Tests cover a cancel while offline, the stop before the outbox on reconnect, held entries that are not applied, an apply two times, a discard, and a release that lets a local worker start.
