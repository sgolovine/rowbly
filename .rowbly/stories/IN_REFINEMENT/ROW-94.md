---
title: Apply outbox entries on the main machine
stage: IN_REFINEMENT
position: 13
dependsOn:
  - ROW-85
  - ROW-90
  - ROW-91
createdAt: 2026-11-16T19:45:08.648Z
updatedAt: 2026-11-16T21:07:38.896Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-94
pull_request: null
---

## Goal

The main machine applies the outbox entries of each host to the board.

Read the Spec `remote-worker-hosts`, section "The outbox".

## Scope

In scope:

- Read the entries from the channel, and the missing entries after a reconnect.
- Apply the entries in `seq` order under the Project write lock. Never take the Project write lock while you hold the state lock.
- Each field change is a compare-and-set: equal to `before` writes `after`, equal to `after` is skipped, another value is a conflict.
- A conflict sets an attention entry, for example `outbox:ROW-5`, with the field and the values.
- For `attachment.add`, get the PNG with `rowbly host blob`, examine the hash, the size and the PNG format, then add the attachment with the id of the host. For `attachment.remove`, remove the attachment if it is there.
- A PNG of a conflict stays in `runtime/hosts/<host>/` for recovery.
- Record the last applied `seq` for each host in `runtime/hosts/<host>/`. Then send the acknowledgement.
- The next scan commits the changes with the usual canonical commit.

Not in scope:

- Held entries of abandoned Threads. Another Story adds them.

## Acceptance criteria

- An entry that arrives two times has one effect.
- A crash between the apply and the acknowledgement does not apply an entry two times.
- Tests cover each entry type, each compare-and-set case and a bad PNG.
