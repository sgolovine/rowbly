---
title: Load the TUI lazily so CLI commands do not pay for Ink
stage: BACKLOG
worktree: null
pull_request: null
---

## Problem

`getStory` in `src/services/story/story-read.ts` reads and parses every Story file two times to give one Story:

1. `findStoryFile` calls `readStoryFiles` to find the file by number.
2. `getStory` calls `readStoryFiles` again for `positionIn`.

It then reads the attachment manifest for the count. The cost grows with the size of the board, for an operation that needs one file.

## Evidence

`strace` on `rowbly story get ROW-1 --json` on a board of 26 Stories shows 52 opens of Story files.

## Proposed fix

- Read the Story file by its path (`storyPath`) instead of a scan of the folder.
- Read the folder one time only, and only when the position in the Stage is necessary.
- Let callers that already have the list of Story files pass it in.

## Acceptance

- `getStory` opens each Story file at most one time.
- The position in the Stage and the attachment count do not change.
- The tests of `story-read` cover a Story with no `position` and a Story in a Stage that is not in the config.
