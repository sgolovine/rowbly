---
title: Show factory connectivity state in the TUI
stage: IN_REFINEMENT
dependsOn:
  - ROW-71
createdAt: 2026-11-16T16:41:21.272Z
updatedAt: 2026-11-16T17:10:08.418Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-73
pull_request: null
---

Split from ROW-71.

Show the connectivity state of the native factory in the TUI. ROW-71 adds the `connectivity` field (`online`, `degraded` or `offline`) to the factory status and the `network` provider pause, and makes the factory resume the Threads that stopped because of a network failure.

This part adds the labels that the original Story asks for:

- The header Factory button shows `offline` or `degraded` (for example `Factory offline`) when the status has that `connectivity`.
- The Thread pane and the Threads tab of a Story show a label on a Thread that waits for connectivity (error class `transient`, code `NETWORK`), for example `waiting for network`.
- The queue reason of a Story whose provider has a `network` pause says that it waits for the network.

Use only the colours in `theme` and the components in `src/tui/components/`. Read the `rowbly-tui-design` skill. Do not add TUI tests.
