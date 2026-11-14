---
title: Share one factory status read across TUI views
stage: BACKLOG
worktree: null
pull_request: null
---

## Problem

The conversation view polls the session file every 500 ms (`startWatch` in `src/services/conversation/conversation-watch.ts`). Each poll:

1. calls `getThread`, which reads and validates the Thread JSON through `runtimePath`
2. reads a page of up to 512 KB from the session index
3. runs `JSON.stringify` on the full page to compare it with the last page

The index itself reads only new bytes, but steps 1 and 3 run in full on each poll, also when nothing changed. Session files in this Project are up to megabytes in size.

## Proposed fix

- Compare the session file size, `mtime`, the scan offset and the leaf ID before a page read. Skip the read when they did not change.
- Read the Thread again only when the Thread file changed, for example from the Thread watch.
- Replace the `JSON.stringify` digest with the IDs and the count of the entries of the page.

## Acceptance

- A poll with no change to the session file and the Thread does no `JSON.stringify` and no page read.
- New entries of a running worker still show in under one second.
