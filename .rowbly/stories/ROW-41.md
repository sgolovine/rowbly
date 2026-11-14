---
title: Preload the Pi SDK after the board paints
stage: DONE
position: 37
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-41
pull_request: https://github.com/sgolovine/rowbly/pull/224
---

## Goal

The TUI starts the Pi SDK import in the background a short time after the board is on the screen. Then the first Pi-backed view (the Models tab, the Factory modal or the AI settings) does not pay the import while the user waits.

## Why

The import blocks the Ink thread for 580 to 720 ms (measured 2026-11-14). At this time it runs when the user opens the Models tab, the Factory modal or the AI settings. When it runs at an idle moment after the first paint, the freeze occurs while the user reads the board.

## Scope

In scope:

- A small service function `preloadPi(loader = loadPi): Promise<void>` in `src/services/pi-runtime/pi-runtime.ts`. It calls the loader and ignores a failure (the promise always resolves).
- A new optional prop `preloadPi?: () => Promise<void>` on `App` (`src/tui/app.tsx`) and `Shell` (`src/tui/shell/shell/shell.tsx`), passed to `useShell` and then to `useShellData`.
- `renderTui` in `src/tui/index.tsx` gets an optional `preloadPi` option and passes it to `App`. `src/cli.ts` passes a function that dynamically imports `./services/pi-runtime/pi-runtime.js` and calls `preloadPi()`. Only the TUI branch of `cli.ts` (no arguments) does this.
- In `useShellData` (`src/tui/shell/shell/use-shell-data.ts`), or in a new hook `use-pi-preload.ts` next to it that `useShellData` calls: when the board data first resolves to a Project (not `null`, not loading, no error), start a timer of 500 ms. When the timer fires, call `preloadPi` one time. Clear the timer on unmount. Do not call it again after a reload or a Project switch.
- When the prop is not given, nothing runs. The `renderTui` test helper (`src/tui/testing/render-tui.tsx`) and all existing TUI tests do not give it, so they never import Pi.
- Tests (see the acceptance criteria).

Not in scope:

- The on-disk cache of the Pi catalog (ROW-39), the shared `ModelRuntime` (ROW-40) and the worker thread (ROW-44).
- Creating a `ModelRuntime` or reading credentials in the preload. The preload only imports the SDK module.
- A preload in the onboarding state (no Project in the directory).
- A change to the CLI commands or the factory daemon.

## Acceptance criteria

- [ ] A unit test of `preloadPi` with a faux loader shows that it calls the loader one time and resolves, also when the loader rejects.
- [ ] A `useShellData` (or `use-pi-preload`) test with fake timers and a faux `preloadPi` shows that the function is not called before the board data resolves, and is not called before 500 ms after that.
- [ ] The same test shows that the function is called exactly one time after the timer, and not again after `reload()`.
- [ ] A test shows that a rejected `preloadPi` gives no toast and no error on the screen.
- [ ] A test shows that with no Project in the directory (board data `null`), `preloadPi` is not called.
- [ ] A test shows that an unmount before the timer fires prevents the call.
- [ ] `src/services/pi-runtime/import-boundary.test.ts` gets a test that renders `App` with the `renderTui` test helper on a test Project without the `preloadPi` prop, waits more than 500 ms, and does not load Pi (the Pi mock throws). All existing tests in that file continue to pass.
- [ ] The board, help, doctor, status and history CLI commands do not load Pi: the import-boundary tests pass, and `src/cli.ts` calls the preload only in the TUI branch (code review).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- `loadPi` is in `src/services/pi-runtime/pi-runtime.ts`: `export const loadPi: PiLoader = () => import("@earendil-works/pi-coding-agent");`. `pi-runtime.ts` has only type imports of Pi at the top level, so a dynamic import of it does not load Pi.
- Data flow: `cli.ts` → `renderTui(options)` (`src/tui/index.tsx`) → `App` → `Shell` → `useShell(initialCtx)` (`use-shell.ts`) → `useShellData(ctx)` (`use-shell-data.ts`). Follow the pattern of the existing `launch` option, which takes the same path from `cli.ts` to the shell.
- Board data: `data` in `useShellData` is an `AsyncState<Board | null>`. `null` means no Project.
- Keep the preload in the TUI only. Do not import `pi-runtime.js` statically from `src/tui/` or from `src/cli.ts`; use a dynamic `import()` inside the function that `cli.ts` passes, so that the CLI path stays free of Pi.
- Use `setTimeout` with `unref()` on the timer, so that the timer does not keep the process alive at exit.
- Keep the Pi SDK behind the lazy boundary in `src/services/pi-runtime/`. Do not add a production faux-provider flag. Do not use live credentials in tests.
- Read `.agents/skills/rowbly-code-style/SKILL.md` and `.agents/skills/rowbly-tui-design/SKILL.md` before the change. Use the `Store` class for any module-level state; do not add a module-level `let`. Use `.js` extensions in relative imports.
- Related: ROW-39 (on-disk cache). With the cache in place, the preload is a warm-up, not a dependency.

## Assumptions

- The delay is 500 ms after the first board data resolves. Reason: the Story says "shortly after" and gives no value. 500 ms lets Ink paint the board and the factory status first, and is short enough that the import usually ends before the user opens a Pi-backed view.
- The opt-out is the absence of a prop: only `cli.ts` gives the preload function. Reason: this is the smallest change that keeps all `renderTui` test-helper tests free of Pi without a global flag or an environment variable, and it agrees with the `launch` pattern.
- The preload runs only when a Project opens (board data not `null`). Reason: the Story is about the time after the board paints; the onboarding state has no board.
- The preload runs one time for each TUI process, not again after a Project switch. Reason: Node caches the imported module, so a second import has no effect.
- The preload only imports the SDK; it does not create a `ModelRuntime`. Reason: the measured cost is the import (580 to 720 ms); `ModelRuntime.create` costs about 12 ms, and ROW-40 owns the shared runtime.
