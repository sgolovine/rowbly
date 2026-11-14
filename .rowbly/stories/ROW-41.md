---
title: Preload the Pi SDK after the board paints
stage: IN_REFINEMENT
worktree: null
pull_request: null
---

## Goal

The TUI starts the Pi SDK import in the background shortly after the board is on the screen, so the first Pi-backed view does not pay the import while the user waits.

## Why

The import blocks the Ink thread for 580 to 720 ms (measured 2026-11-14). Today it runs when the user opens the Models tab, the Factory modal or the AI settings. Moved to an idle moment after first paint, the freeze happens while the user reads the board.

## Scope

- One idle-delayed `loadPi()` call from the shell after the board data loads. A failure is ignored; the views still load Pi on demand.
- An opt-out for tests, so `renderTui` tests never import Pi (`import-boundary.test.ts` must keep passing).
- Tests that the preload does not run before the board data is ready and does not run in the CLI paths.

## Technical notes

- `loadPi` is in `src/services/pi-runtime/pi-runtime.ts`. The shell data hook is `src/tui/shell/shell/use-shell-data.ts`.
- Keep the safety rule: board, help, doctor, status and history CLI commands must not load Pi. The preload is TUI only.
- Pairs with the on-disk cache Story; with the cache in place the preload is a warm-up, not a dependency.
