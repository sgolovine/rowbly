---
title: Build the animated board section of the landing page
stage: BACKLOG
worktree: null
pull_request: null
---

## Goal

Build the "Stories move themselves" section: an animated board that teaches the main loop of Rowbly in ten seconds.

## Scope

- Anchor: `#see-it-work`.
- Headline: **Stories move themselves.**
- Copy: "You write a Story in a sentence. The factory picks it up, refines it into a spec, builds it on its own branch, opens a PR and moves it to review. You read the PR and press merge."
- An animated board with five columns: Backlog, In Refinement, In Development, In Review, Done. Cards with Story keys and short titles (use titles from the Tic-Tac-Toe screenshot, for example "TTT-41 Add an undo button for two-player games").
- On a slow loop (one move about every 2 s), a card moves one column to the right. When a card enters a working column, an `AgentTag` (for example `claude-4`, `codex-7`) appears next to it with a blinking cursor. At Done the tag goes away.
- Hover or focus on a column header shows its Stage prompt in a tooltip:
  - In Refinement: "Turn this Story into a spec with acceptance criteria."
  - In Development: "Build it, open a PR, move it to In Review."
  - In Review: "Review the PR."
- Build with CSS/SVG and React. No video, no heavy animation library unless it is small (for example `motion`).
- Ease-out only, no bounce. With `prefers-reduced-motion`, show a static board with cards in all columns.
- On small screens, show the columns as a vertical list or a horizontal scroll that stays readable.

## Acceptance criteria

- [ ] The loop runs without layout shift and uses less than 5% CPU when idle in Chrome.
- [ ] The animation pauses when the section is off screen.
- [ ] Tooltips work with the keyboard.
- [ ] Reduced motion shows the static board.
- [ ] The copy matches the Spec `website-content-plan`, section 3.3.

## Technical notes

Depends on the layout Story. See the Motion principles in the Spec.
