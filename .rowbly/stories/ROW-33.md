---
title: Do not reload the board when only state.json changes
stage: BACKLOG
position: 8
worktree: null
pull_request: null
---

## Problem

`useStoryChanges` in `src/tui/hooks/use-story-changes.ts` calls `watchStories` without `includeState: false`. The watch covers all of `.rowbly/`, so each write of `.rowbly/state.json` by the factory reloads the full board in the TUI.

A board reload reads the config, every Stage, every Story file and every attachment manifest. The supervisor already passes `includeState: false` for its own watch.

## Proposed fix

- Pass `{ includeState: false }` from `useStoryChanges`.
- Check what the board shows from `state.json`. If the factory activity on the rows needs it, read only `state.json` again on its change, not the full board.

## Acceptance

- A write of `state.json` alone does not read any Story file.
- The factory activity on the Story rows still updates when the factory starts or ends an attempt.
