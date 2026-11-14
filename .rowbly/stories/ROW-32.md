---
title: Skip conversation polls when the session file did not change
stage: IN_DEVELOPMENT
position: 2
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-32
pull_request: null
---

## Goal

The conversation view polls the session file of a Thread every 500 ms (`startWatch` in `src/services/conversation/conversation-watch.ts`). Each poll does this work:

1. It calls `getThread`. `getThread` reads and validates the Thread JSON through `runtimePath`.
2. It reads a page of up to 512 KB from the session index (`SessionIndex.page`, which reads up to 20 entries from disk).
3. It runs `JSON.stringify` on the full page to compare it with the last page (`deliver`).

The index reads only new bytes, but steps 1 to 3 run in full on each poll, also when nothing changed. Session files in this Project are up to megabytes in size. This wastes CPU and I/O while a person looks at an idle Thread in the TUI.

The result: a poll with no change to the Thread file and the session file does almost no work. New entries of a running worker still show in under one second.

## Scope

In scope:

- A cheap change check at the start of each watch poll. If the Thread file and the session file did not change since the last successful poll, the poll stops before `getThread` and before the page read.
- Read the Thread file again only when its `stat` changed.
- Replace the `JSON.stringify` digest in `deliver` with a small digest of the page.
- Tests for the skip and for the delivery of new entries.

Not in scope:

- Explicit reads (`Conversation.read`, `readConversationPage`, `getThreadLog`). They continue to read the Thread and the page each time.
- A change of the 500 ms poll interval, or a change from polling to `fs.watch`.
- A change of the `watchThreads` service in `src/services/thread/thread-watch.ts`.
- Changes to `SessionIndex` page logic or to the TUI components.

## Acceptance criteria

- [ ] When the Thread file and the session file do not change, a watch poll does not call `getThread` (no read of the Thread JSON), does not call `SessionIndex.page` and does not call `JSON.stringify`. A test in `src/services/conversation/conversation-watch.test.ts` (or `conversation.test.ts`) examines this, for example with `vi.spyOn(SessionIndex.prototype, "page")` and a spy on the Thread file read, over a minimum of 3 polls after the first delivery.
- [ ] `src/services/conversation/conversation-watch.ts` does not contain `JSON.stringify` (examine with `grep`).
- [ ] When a new entry is appended to the session file of a watched Thread, `onChange` gets a page with that entry in less than 1000 ms. A test examines this with `vi.waitFor(..., { timeout: 1000 })`.
- [ ] When the Thread file changes (for example a new `session.leafId` or a new `session.file`), the next poll reads the Thread again and delivers the page of the new leaf or file. A test examines this.
- [ ] When the session file does not exist yet and later appears, the watch delivers the `missing` page one time and then the `ok` page. The existing test "gives the first page once and forgets the watch on stop" continues to pass.
- [ ] After a poll that fails (`onError`), the next poll does the full read again (the failed poll does not record a signature).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Files: `src/services/conversation/conversation-watch.ts`, `conversation-state.ts` (`WatchState`), possibly `conversation-read.ts` (for a variant of `readThreadPage` that takes an already-read Thread), and their tests.
- Thread path: `threadPath(id, ctx)` in `src/services/thread/thread-files.ts` gives the checked path. `readThreadFile` reads and validates it. `getThread` is the public reader.
- Signature: for each file, use `ino`, `size`, `mtimeMs` and `ctimeMs` from `stat`, or a "missing" value for `ENOENT`. This agrees with `isReplaced` in `session-index.ts`, which uses the same fields. The session file path comes from the cached Thread record (`thread.session.file`) through `runtimePath(env.paths, file)`.
- Skip rule: skip the poll when the Thread signature, the session signature and the leaf ID are equal to the values of the last successful poll. The leaf ID comes from the cached Thread, so an unchanged Thread signature also gives an unchanged leaf.
- Keep the `runtimePath` symlink checks on the paths before each `stat`. These checks are `lstat` calls and are cheap. Do not remove security checks for speed.
- Keep the store pattern: put the cached Thread and the signatures in `WatchState` (or in `ConversationState` if `read()` also uses them). Obey the `rowbly-code-style` skill (no classes for state, `Store` updates).
- New digest for `deliver`: join `status`, `invalidLines`, `nextBefore`, the entry count and the entry IDs. Entries of a session file are append-only and an entry ID does not change its content. A replaced file resets the index, so this digest is sufficient.
- `queueRead` serialises reads. The cheap check can run before the queue, but the full read must stay in the queue.
- The poll interval stays 500 ms, so a new entry shows in under 1000 ms.
- Update `docs/architecture/native-factory/threads-and-history.md` with one short STE sentence about the skip, if that page describes the conversation watch.

## Assumptions

- The change check uses `stat` of the Thread file and not the `watchThreads` file watch. Reason: the Story says "for example from the Thread watch", so a watch is not mandatory. `stat` is smaller in scope, works the same on all platforms and does not need a second recursive `fs.watch` for each open conversation.
- Explicit `read()` calls are not changed. Reason: the problem is the idle poll. An explicit read is a user action and must give fresh data.
- The `runtimePath` validation stays on each poll. Reason: it protects against symlinks in the private runtime tree, and its cost is small compared to a Thread read and a page read.
- The new digest does not include the entry text. Reason: session files are append-only. A rewrite changes `ino`, `size`, `mtimeMs` or `ctimeMs` and resets the index, which gives new entry IDs or a different page.
