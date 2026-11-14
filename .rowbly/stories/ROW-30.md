---
title: Reduce the cost of runtimePath checks on hot runtime reads
stage: IN_REFINEMENT
position: 3
worktree: null
pull_request: null
---

## Problem

`runtimePath` in `src/services/runtime-files/runtime-files.ts` runs for every read of a runtime file. Each call does one `realpath` on the Project folder and one `lstat` for each segment of the path, one at a time.

Hot paths call it again and again: `getThread` for each Thread in `listThreads`, the factory status read, the owner read and each poll of the conversation view.

## Proposed fix

- Validate the runtime root and the fixed folders (`threads`, `sessions`, `logs` and so on) one time for each operation, then check only the last segment for each file.
- Or cache a successful check of a folder for a short time in the process, and check again after an error.
- Keep the symlink protection. A symlink that appears later must still give a `ValidationError` before a write.

## Acceptance

- `listThreads` on N Threads does a fixed count of folder checks plus one check for each file, not one check for each segment of each file.
- The symlink tests of `runtime-files` still pass.
