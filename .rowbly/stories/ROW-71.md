---
title: Better offline handling
stage: BACKLOG
createdAt: 2026-11-16T16:32:19.285Z
updatedAt: 2026-11-16T16:32:19.285Z
worktree: null
pull_request: null
---

During the course of running the factory. The machine running it may go offline or experience a connectivity issue with the AI threads that it is running.

In this event, we should gracefully let the user know by adding error labels in the appropriate parts of the app: thread, header, etc.
