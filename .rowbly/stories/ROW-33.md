---
title: Do not reload the board when only state.json changes
stage: IN_DEVELOPMENT
position: 2
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-33
pull_request: null
---

## Goal

The TUI reads the full board again each time the factory writes `.rowbly/state.json`. A board read reads the config, all Stages, all Story files and all attachment manifests. The factory writes `state.json` frequently, so this work is not necessary and makes the TUI slow on large Projects.

`useStoryChanges` in `src/tui/hooks/use-story-changes.ts` calls `watchStories` without `includeState: false`. The watch covers all of `.rowbly/`, so a write of `state.json` calls `data.refresh` in `useShellData`, and `loadBoard` reads the full board again. The supervisor already passes `includeState: false` for its own watch (`src/services/factory-manager/supervisor-loop.ts`).

The board uses `state.json` for one thing: the factory activity of each Story row (`Board.activity`, from `getFactoryActivity` in `src/services/factory-activity/factory-activity.ts`). The result: a write of `state.json` alone reads only `state.json` again and updates the activity of the rows. It does not read the Stories again.

## Scope

In scope:

- Pass `{ includeState: false }` from `useStoryChanges` to `watchStories`.
- Add a service watch that calls back only for changes to `state.json` (names that start with `state.json`, the same match as `isIgnored` in `src/services/story-watch/story-watch.ts`). Use the same 100 ms quiet time, `persistent: false` and the same `error` handling as `watchStories`.
- Add a TUI hook for that watch (in `src/tui/hooks/`, exported from `src/tui/hooks/index.ts`).
- In `src/tui/shell/shell/use-shell-data.ts`, load the activity apart from the Stories. On a `state.json` change, call `getFactoryActivity` again with the Stories that are already loaded. Do not call `getProject`, `listStages` or `searchStories`.
- Keep `Board.activity` available to `shell-props.ts` and `shell-frame.ts` with the same shape, so that the consumers do not change.
- Tests for the new watch, the new hook and the changed `useShellData`.

Not in scope:

- Changes to how the factory writes `state.json`.
- Changes to `watchThreads`, `useFactoryChanges` or the factory status (`runtime/status.json`).
- Changes to the default of `watchStories`. The default still includes `state.json`.

## Acceptance criteria

- [ ] `useStoryChanges` passes `{ includeState: false }` to `watchStories`.
- [ ] A new service watch calls back one time after a write of `.rowbly/state.json`, and does not call back after a change to a Story file or to a file in `.rowbly/runtime/`. A test in the service folder examines this.
- [ ] In a `useShellData` test, a write of `state.json` alone does not call `searchStories` (or does not read any Story file). Example method: a `vi.spyOn` on the Story service, or a count of `loadBoard` calls.
- [ ] In a `useShellData` test, after a write of a valid `state.json` with a `running` attempt for an existing Story in its current Stage, `data.data.activity.stories[<id>]` becomes `{ kind: "active", ... }`. After a write that removes the attempt or sets it to `completed`, the entry goes away.
- [ ] A change to a Story file still reads the board again, and the activity is computed for the new Stories (for example, a Story that moves to a different Stage loses an activity that is for its old Stage).
- [ ] The existing test `ignores runtime watcher floods and retains state activity invalidation` in `story-watch.test.ts` still passes (the default of `watchStories` does not change).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- `src/services/story-watch/story-watch.ts`: `watchStories(onChange, ctx, { includeState })`. `isIgnored` already matches `state.json*`. A small new function, for example `watchFactoryState(onChange, ctx)`, can go in this file or in `src/services/factory-activity/`. Services must not import `react` or `ink`.
- `src/tui/hooks/use-story-changes.ts`: copy its pattern (`AbortController`, `stopOnAbort`, ignore a watch that cannot start) for the new hook.
- `src/tui/shell/shell/use-shell-data.ts`: `loadBoard` now computes `activity` after the Stories load. One possible design: `loadBoard` returns project, stages and stories; a second `useAsync` computes the activity from `data.data?.stories` and a state version that the new hook increments; `useShellData` merges them into the `Board` that it returns. Keep the board visible while the activity reloads (use `refresh`, not `reload`, so that no loading state shows). A problem with the state file is a status, not a failure (see the comment in `loadBoard`).
- `Board` is in `src/tui/shell/shell/shell-state.ts`. Consumers: `shell-props.ts` (`board.activity`, `board.activity.stories`) and `shell-frame.ts` (`board.activity.status`).
- Tests: `src/services/story-watch/story-watch.test.ts`, `src/tui/shell/shell/use-shell-data.test.tsx`, and a test next to the new hook. Use `useTestProject` and `project.paths.stateFile`. The valid state file format is version 1 with `attempts` entries of `story`, `stage`, `workerId`, `status`, `model` (see `factory-activity.ts` and its test for examples).
- Read the `rowbly-code-style` skill before the change. Use dash-case file names and `.js` import extensions.

## Assumptions

- The board does not use `state.json` for data other than `Board.activity`. Reason: `grep` shows `getFactoryActivity` in `loadBoard` as the only reader of the state file in `src/tui/shell/`; the factory status uses `runtime/status.json` through `useFactoryChanges`.
- A separate state-only watch is better than a second option on `watchStories`. Reason: it keeps the default of `watchStories` and the supervisor watch the same, and it is the smallest change. The developer can put the function in `story-watch.ts` if that is simpler.
