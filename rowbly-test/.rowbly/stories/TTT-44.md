---
title: Persist the game in progress across reloads
stage: IN_REVIEW
worktree: .worktrees/ttt-44
pull_request: https://github.com/example/tic-tac-toe/pull/144
agentLock:
  agent: codex-4
  stage: IN_REVIEW
  lockedAt: 2026-11-09T22:24:03.386Z
---

A page reload restores the board, the turn and the mode.

## Acceptance criteria

- [ ] A corrupt saved state falls back to a new game.
- [ ] The saved state has a schema version.
