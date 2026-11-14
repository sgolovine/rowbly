---
title: Reduce the cost of runtimePath checks on hot runtime reads
stage: IN_DEVELOPMENT
position: 4
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-30
pull_request: null
---

## Goal

`runtimePath` in `src/services/runtime-files/runtime-files.ts` runs for each read of a runtime file. Each call does one `realpath` on the Project folder and one `lstat` for each segment of the path, one at a time.

Hot paths call it again and again. `listThreads` calls `getThread` for each Thread. `getThread` checks `threads/<id>.json` (1 `realpath` and 3 `lstat`) and then the session reference `sessions/<id>/<file>.jsonl` (1 `realpath` and 4 `lstat`). Thus one Thread costs 2 `realpath` and 7 `lstat`. The factory status read, the owner read and each poll of the conversation view also call it.

The result for the user: `rowbly thread list`, the factory status and the TUI Thread views do fewer file system calls, and the symlink protection of the runtime tree stays the same.

## Scope

In scope:

- A new function in `runtime-files.ts` that checks one runtime folder one time and gives a handle. A second function gives the path of one child of that folder and checks only the new segments.
- `listThreads` uses this function: it checks the Project folder, the runtime root, `threads/` and `sessions/` one time for each call, and then checks only the segments below them for each Thread.
- Tests for the check count and for the symlink protection.

Not in scope:

- A time-based cache of checks across operations (the second option of the original Story).
- Changes to the factory status read, the owner read (`factory-ownership.ts`) and the conversation poll (`conversation-read.ts`). These read paths of depth 1 or 3, and they read one file per operation.
- Changes to the behaviour of `runtimePath` for its other callers.

## Acceptance criteria

- [ ] `listThreads` on N Threads, each with a session reference, calls `realpath` a fixed number of times (not related to N).
- [ ] `listThreads` on N Threads calls `lstat` at most `C + 3 × N` times, where `C` is a fixed number: one check for the Thread file, one for the folder `sessions/<id>` and one for the session file. A Vitest test spies on `lstat` and `realpath` of `node:fs/promises` and examines the counts for two values of N (for example 1 and 5).
- [ ] A symlink at `threads/<id>.json`, at `sessions/<id>` or at the session file gives a Thread issue in the `listThreads` result, as before.
- [ ] A symlink at the runtime root, at `threads/` or at `sessions/` makes `listThreads` fail with a `ValidationError` that contains "symlink" (or, for `threads/`, the same error as now).
- [ ] A child name that is empty, absolute, contains `..` or leaves the checked folder gives `ValidationError("Invalid runtime path")`.
- [ ] `getThread` and `saveThread` keep their signatures and their results.
- [ ] The existing tests of `runtime-files.test.ts` and of `src/services/thread/` pass without changes to their expectations.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- `src/services/runtime-files/runtime-files.ts`: keep `runtimePath`. Add, for example, `checkRuntimeDir(paths, reference): Promise<RuntimeDir>` (does the `realpath` check of `paths.dir` and the `lstat` of each segment, once) and `runtimeChild(dir: RuntimeDir, reference): Promise<string>` (validates the reference against traversal and checks only the segments below `dir`). Reuse `assertNotSymlink` and `pathsToCheck`. The names are a proposal.
- The check before each write must stay: a symlink that appears after the folder check must still give a `ValidationError` before a write. A handle is only for one operation. Do not keep a handle in a module variable or across calls of a service.
- `src/services/thread/thread-files.ts`: add an internal read function that takes the checked `threads/` and `sessions/` handles. `getThread` builds the handles and calls it. `listThreads` (`src/services/thread/thread-list.ts`) builds the handles one time and reads each Thread with them. Also call `findProject` one time in `listThreads` and not again for each Thread.
- Keep the reads one at a time with `mapInOrder` (see the comment in `thread-list.ts`).
- Read the `rowbly-code-style` skill before the change. Update `docs/architecture/native-factory/runtime-and-locks.md` or `docs/architecture/storage.md` if they describe how `runtimePath` checks paths. Write the docs in STE.

## Assumptions

- Select the per-operation check (first option) and not a time-based cache. Reason: it has the smallest scope, it has no stale state, and it keeps the symlink protection simple.
- "One check for each file" in the original acceptance means a fixed number of checks for each Thread, not related to the depth of the path. The session reference `sessions/<id>/<file>.jsonl` has a folder for each Thread, so each Thread has up to 3 `lstat` checks. Reason: the session folder is different for each Thread and cannot be checked one time.
- Only `listThreads` and `getThread` change. Reason: the Story names `listThreads` in its acceptance, and the other hot paths read one file per operation, so a shared folder check does not reduce their cost much.
