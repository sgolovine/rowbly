---
title: Build the online multiplayer WebSocket server
stage: IN_DEVELOPMENT
worktree: .worktrees/ttt-49
pull_request: null
agentLock:
  agent: claude-9
  stage: IN_DEVELOPMENT
  lockedAt: 2026-11-09T21:55:03.510Z
---

Add a small server that relays moves between two players.

## Acceptance criteria

- [ ] The server validates each move against the shared rules.
- [ ] A health endpoint reports the number of open rooms.
