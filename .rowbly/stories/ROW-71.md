---
title: Better offline handling
stage: IN_REFINEMENT
position: 1
createdAt: 2026-11-16T16:32:19.285Z
updatedAt: 2026-11-16T16:40:04.982Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-71
pull_request: null
---

During the course of running the factory. The machine running it may go offline or experience a connectivity issue with the AI threads that it is running.

- In this event, we should gracefully let the user know by adding error labels in the appropriate parts of the app: thread, header, etc.
- We should also suspend services in the background while we wait for internet connectivity to AI services to be restored.
- Plan for a scenario where just one provider is having issues. Also plan for a scenario where internet goes out entirely.
- When internet returns, tasks must auto-resume.
