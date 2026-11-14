---
title: Read only changed Threads when a worker writes its activity
stage: DONE
position: 26
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-29
pull_request: https://github.com/sgolovine/rowbly/pull/213
---

## Goal

Each running worker writes its Thread JSON one time each second (`writeActivity` in `src/services/factory-manager/worker-launch.ts`, with `setInterval(..., 1000)`). `watchThreads` (`src/services/thread/thread-watch.ts`) calls back on any change under `runtime/threads`. Then each open view runs `listThreads` again:

- the Threads tab of the Story Modal (`src/tui/screens/stories/threads-tab/use-threads-tab.ts`, through `useFactoryChanges`)
- the Factory view (`src/tui/screens/threads/factory-view/use-factory-view.ts`, through `useThreadChanges`)
- the Factory modal (`src/tui/screens/factory/factory-modal/use-factory-modal.ts`, through `watchThreads`)

`listThreads` (`src/services/thread/thread-list.ts`) reads and validates every Thread file, one at a time in name order, for one changed file. This Project has 68 Thread files. With two workers, each open view reads all 68 files about two times each second.

Result: one activity write causes at most one Thread file read for each open view. The views still show new Threads and status changes quickly.

## Scope

In scope:

- A cache of parsed and validated Thread records in `listThreads`. The key is the absolute file path. The cache keeps a record while the file identity is the same: `ino`, `size` and `mtimeNs` (from `stat` with `{ bigint: true }`). If one of these values changes, `listThreads` reads and validates the file again.
- Removal of cache entries for files that are not in the directory listing any more.
- Tests for the cache in `src/services/thread/thread-list.test.ts`.

Not in scope:

- A change to the watch callback API (give the changed file names to the callback). The cache gives the same result with no change to the hooks.
- A change of the activity write rate or a separate activity file. The 1 s activity data in the Factory view must stay.
- A change of `getThread` or `saveThread`. `getThread` continues to read the file each time.

## Acceptance criteria

- [ ] With N valid Thread files, a first `listThreads` call reads N files. A second call with no file change reads 0 Thread files. A test examines this with a spy on `readFile` of `node:fs/promises` (for example `vi.mock` with a passthrough) or an equivalent count.
- [ ] After `saveThread` (or `changeThread`) changes one Thread, the next `listThreads` call reads exactly 1 Thread file and returns the new data of that Thread. A test examines this.
- [ ] A new Thread file appears in the next `listThreads` result. A removed Thread file is not in the result, and its cache entry is removed. A test examines this.
- [ ] A file that cannot be read or validated still gives an issue in `issues`, on each call. An invalid file is not cached as a valid record. If a person repairs the file, the next call returns the Thread. A test examines this.
- [ ] The filters (`story`, `role`, `status`) and the sort order (`createdAt`, then `id`) do not change. The existing test in `thread-list.test.ts` passes.
- [ ] Two different Projects in one process do not share cache entries (the key is the absolute path). A test or the key design examines this.
- [ ] The watch debounce (100 ms in `thread-watch.ts`) does not change, so the Threads tab and the Factory view still show new Threads and status changes in under one second. The existing `thread-watch.test.ts` and the TUI hook tests pass.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- `readThread` in `src/services/thread/thread-files.ts` does `stat` (size limit 1 MiB), `readFile`, `JSON.parse`, `validateThread`, an ID check and `checkSession`. The cache must keep the same validation for each file that it reads. Recommended design: add a function in `thread-files.ts` (or a new `thread-cache.ts` in `src/services/thread/`) that does one `stat({ bigint: true })`, compares `ino`, `size` and `mtimeNs` with the cache entry, and calls the existing read and validate path only on a difference.
- `saveThread` uses `writeFileAtomic` (temporary file, then rename). A rename gives a new `ino`, so the cache sees the change also if `mtime` and `size` are equal.
- Do the `stat` before the read. If the file changes between the `stat` and the read, the next call sees a new identity and reads it again. Do not cache with values from a `stat` after the read.
- Keep the reads one at a time with `mapInOrder` (too many parallel reads can use all file handles). The `stat` calls can also stay in order.
- `ThreadRecord` fields are `readonly`, so `listThreads` can return the cached object. Do not mutate a cached record.
- Keep the cache state in a module-level `Map` (or a `Store`, see the `rowbly-code-style` skill). The cache is per process. It has no TTL, because the file identity check is the authority.
- `checkSession` calls `runtimePath`, which examines symlinks on disk. It does not read the Thread file, so it is not necessary to run it again for a cached record.
- Other callers of `listThreads` (`manager-status.ts`, `supervisor-loop.ts`, `worker-reservation.ts`, `factory-recovery.ts`, `doctor/project-checks.ts`, `commands/thread/thread.ts`) also get the cache. Their results do not change, because a changed file is always read again.
- Read the `rowbly-code-style` skill before you change `src/`. Use `.js` extensions in relative imports. Update the architecture docs if they describe how `listThreads` reads files (search `docs/architecture/` for `listThreads`), in STE.

## Assumptions

- The fix is a cache by file identity in `listThreads`, not file names in the watch callback. Reason: smallest scope. It fixes all three views and all other callers with no change to the hooks, and it also handles events that `fs.watch` merges or loses.
- A `stat` of each Thread file on each list is acceptable. Reason: the acceptance criterion counts file reads. A `stat` is much less work than a read, a parse and a validation.
- The activity write rate stays at 1 s. Reason: the Factory view shows the live activity, and the author marked this option only as "consider".
- The identity uses `ino`, `size` and `mtimeNs`. Reason: an atomic rename changes `ino`, and `mtimeNs` has a finer resolution than `mtimeMs`.
