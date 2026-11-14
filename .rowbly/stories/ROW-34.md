---
title: Read attachment manifests in search only when the query needs them
stage: IN_REFINEMENT
position: 5
worktree: null
pull_request: null
---

## Problem

`searchStories` in `src/services/story/story-read.ts` runs `withAttachmentNames` for every Story before it applies a filter. For each Story this does two `lstat` calls in `attachmentDir`, one `lstat` on the manifest and one manifest read.

The search uses the attachment names in the query text, so a text search needs them. But the TUI board calls `searchStories({})` with no filter to load the board, so each board load and each reload pays for data of the search. A filter by Stage or by field also reads every manifest.

## Proposed fix

- Read the attachment manifests only when the search has query words.
- Apply the Stage and field filters before any attachment read.
- Give the board a list function that does not read attachment names. Read the attachment count separately if the rows need it.

## Acceptance

- `searchStories({})` and a search by Stage only do not read attachment manifests for Stories that the filter removes.
- A text search still matches attachment names.
- The board still shows the attachment count, if it shows it today.
