---
title: Share one factory status read across TUI views
stage: IN_DEVELOPMENT
position: 1
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-31
pull_request: null
---

## Goal

The TUI reads the factory status too often, and more than one view reads it separately:

- `useFactoryChanges` (`src/tui/hooks/use-thread-changes.ts`) reads it again on a 5 s timer.
- It also reads it again on each write of `runtime/status.json`, `runtime/factory.lock` and the thread metadata in `runtime/threads`.
- The supervisor writes `status.json` on a 5 s heartbeat and on each change.
- The shell (`src/tui/shell/shell/use-shell-data.ts`) and the Threads tab of a Story (`src/tui/screens/stories/threads-tab/use-threads-tab.ts`) each call `useFactoryChanges` and `getFactoryStatus` separately. Each has its own watcher and its own 5 s timer.

Each call of `getFactoryStatus` (`src/services/factory/factory.ts`) reads the owner lock, probes the owner process in `/proc`, validates the runtime paths and parses `status.json`.

The result for the user: the TUI does less file and `/proc` work while a factory runs, and the status that the views show stays correct.

## Scope

In scope:

- One shared factory status source in the TUI. The shell owns it. The Factory view, the header and the Threads tab read the status from it. One status write causes one status read.
- The timer read only occurs after 5 s with no read. A file event read resets the timer.
- A short cache of the process identity of the owner in the read-only status path.
- Tests for each change.

Not in scope:

- Changes to how often the supervisor writes `status.json`.
- Changes to `probeOwner` behaviour in the ownership takeover path (`acquireFactoryOwnership`, recovery). This path must always read `/proc`.
- Changes to the CLI `rowbly factory status` output.

## Acceptance criteria

- [ ] With the Factory view open and the Threads tab of a Story selected, one write of `runtime/status.json` causes exactly one call of `getFactoryStatus` in the TUI. A test examines this, for example with a spy on the service or a counter in the shared source.
- [ ] The Threads tab shows the queue entry of its Story (`queueEntry`) from the shared status, and it does not call `getFactoryStatus` itself when the shared source is available.
- [ ] A thread metadata change in `runtime/threads` still reloads the thread list of the Threads tab.
- [ ] With no file events, the status is read again 5 s after the last read. A test with fake timers examines this.
- [ ] When a file event causes a read, the timer read does not occur until 5 s after that read. A test with fake timers examines this.
- [ ] A factory that stops without a file write (owner process gone) shows as stopped in under 10 s. A test examines this, for example with a dead PID in `factory.lock` and fake timers.
- [ ] In the status path, a second probe of the same owner (same `pid` and `processIdentity`) within the cache period does not read `/proc/<pid>/stat` again. A unit test examines this.
- [ ] `acquireFactoryOwnership` and recovery do not use the cache. A unit test or a code review examines this.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Shared source: add a React context (for example `FactoryStatusContext` in `src/tui/hooks/`) that holds the `AsyncState<FactoryStatus | undefined>` of the shell, from `useShellData`. Provide it in `src/tui/shell/shell/shell.tsx` around the screens and overlays. The Story modal with `ThreadsTab` renders inside the shell tree (`story-tab-panes.tsx`).
- Threads tab: `loadThreads` reads only `listThreads`. Use `useThreadChanges` (no `factory` flag) for the thread list. Read the status from the context. When there is no provider (standalone component tests), keep the old own read as a fallback, so that the existing tests stay valid.
- Timer: in `useThreadChanges` with `factory`, replace `setInterval` with a timeout that restarts after each call of `onChange` (from a file event or from the timer). Keep `FACTORY_POLL_MS = 5000`. Update `use-thread-changes.test.tsx`.
- Owner probe cache: the identity is `boot_id:starttime` from `processIdentity` in `src/services/factory-ownership/ownership-lock.ts`.
  - The boot ID does not change while the machine runs. Read `/proc/sys/kernel/random/boot_id` one time for each process and keep it.
  - Add a cached probe (for example `probeOwnerCached`) that `getFactoryStatus` in `src/services/factory/factory.ts` uses. Key: `pid` + `owner.processIdentity`. It still calls `process.kill(pid, 0)` on each probe, so a process that exits gives `dead` at once. Only an `alive` result is cached, for a maximum of 5 s.
  - `acquireFactoryOwnership` keeps the uncached `probeOwner`.
- Services stay free of React. The context and hooks go in `src/tui/hooks/`. Read the `rowbly-code-style` and `rowbly-tui-design` skills before the work.
- Update `docs/architecture/tui.md` (or the native factory docs) if they describe how the TUI reads the factory status. Write it in STE.

## Assumptions

- The shell owns the shared status source, as a React context. Reason: the shell already reads the status for the header and the Factory view, and the Threads tab renders inside the shell tree. This is the smallest change.
- "Skip the timer read when a file event came during the last poll period" is done as a timer that restarts after each read. Reason: a fixed interval that skips a tick can delay the detection of a stopped factory to almost 10 s. A restarting timer keeps it at 5 s after the last read, which satisfies "under 10 s".
- The PID identity cache applies only to the read-only status path, with a 5 s maximum age, and `process.kill(pid, 0)` still runs each time. Reason: a cache of the identity for the full life of a PID cannot detect PID reuse. In the takeover path, a wrong `alive` would block a new factory forever. A short cache keeps the stopped detection under 10 s.
- Thread metadata writes no longer cause a status read in the Threads tab. Reason: the thread list and the status are separate data. The shell watch still reads the status on factory file changes.
