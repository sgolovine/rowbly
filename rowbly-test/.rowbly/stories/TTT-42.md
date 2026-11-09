---
title: Add move history with a step list
stage: IN_REVIEW
worktree: .worktrees/ttt-42
pull_request: https://github.com/example/tic-tac-toe/pull/142
agentLock:
  agent: claude-2
  stage: IN_REVIEW
  lockedAt: 2026-11-09T22:21:03.339Z
---

Show each move in order and let players jump to an earlier position.

## Acceptance criteria

- [ ] Each entry shows the player and the cell, for example `X → B2`.
- [ ] A new move after a jump discards the later history.
