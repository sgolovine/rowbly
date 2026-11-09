---
title: Add an undo button for two-player games
stage: IN_REVIEW
worktree: .worktrees/ttt-41
pull_request: https://github.com/example/tic-tac-toe/pull/141
agentLock:
  agent: claude-1
  stage: IN_REVIEW
  lockedAt: 2026-11-09T22:26:03.313Z
---

Let players take back the last move during a local game.

## Acceptance criteria

- [ ] Undo removes the most recent move and restores the turn.
- [ ] Undo is disabled on an empty board and after the game ends.
