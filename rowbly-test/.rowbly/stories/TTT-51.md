---
title: Reconnect a dropped player to the room
stage: IN_DEVELOPMENT
worktree: .worktrees/ttt-51
pull_request: null
agentLock:
  agent: claude-11
  stage: IN_DEVELOPMENT
  lockedAt: 2026-11-09T21:30:03.565Z
---

A player who loses the connection can return to the same game.

## Acceptance criteria

- [ ] The server holds the seat for 60 seconds.
- [ ] The other player sees a `reconnecting` status.
