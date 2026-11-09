---
title: Fix a double move on a fast double tap
stage: IN_REVIEW
worktree: .worktrees/ttt-48
pull_request: https://github.com/example/tic-tac-toe/pull/148
agentLock:
  agent: claude-8
  stage: IN_REVIEW
  lockedAt: 2026-11-09T22:10:03.484Z
---

A quick double tap on mobile can place two marks in one turn.

## Acceptance criteria

- [ ] A second tap during a pending move does nothing.
- [ ] A regression test covers the double tap.
