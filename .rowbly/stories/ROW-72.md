---
title: Add `expandedByDefault` to rowbly config
stage: IN_REFINEMENT
position: 2
createdAt: 2026-11-16T16:34:16.401Z
updatedAt: 2026-11-16T16:35:52.464Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-72
pull_request: null
---

We define stages in Rowbly config (.rowbly/rowbly.config.json), We should also define whether the stage is opened by default when the app runs.

Add `expandedByDefault` to the rowbly config for each stage. If true then it will be expanded when  the user starts the app, otherwise collapsed.
