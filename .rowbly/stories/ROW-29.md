---
title: Read only changed Threads when a worker writes its activity
stage: IN_REFINEMENT
position: 2
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-29
pull_request: null
---

## Problem

Each running worker writes its Thread JSON one time each second (`writeActivity` in `src/services/factory-manager/worker-launch.ts`). `watchThreads` calls back on any change under `runtime/threads`, so each open view that uses `useThreadChanges` or `useFactoryChanges` runs `listThreads` again:

- the Threads tab of the Story Modal
- the Factory view
- the Factory modal

`listThreads` reads every Thread file one at a time, in name order, and validates each one, for one changed file.

## Evidence

This Project has 68 Thread files. With two workers, each open view reads all 68 files about two times each second.

## Proposed fix

- Give the watch callback the names of the changed files, and read only those Threads again.
- Or keep a cache of Thread records by file `mtime` and size, and read only the files that changed.
- Consider a lower rate for the activity write, or a separate activity file that the list does not watch.

## Acceptance

- One worker activity write causes at most one Thread file read for each open view.
- The Threads tab and the Factory view still show new Threads and status changes in under one second.
