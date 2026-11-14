---
title: Load the TUI only when rowbly starts without a command
stage: IN_REFINEMENT
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-43
pull_request: null
---

## Goal

`rowbly <command>` and the factory daemon start without loading Ink, React or any TUI screen. Only bare `rowbly` imports the TUI.

## Why

`src/cli.ts` imports `renderTui` statically, so every CLI call loads the full TUI before Commander parses. Measured 2026-11-14: bare Node starts in 0.02 s, `rowbly --version` in 0.42 s, and `rowbly story get` in 0.43 to 0.48 s. The Story read itself is tens of milliseconds. Ink alone imports in about 270 ms. The factory daemon starts from the same entry, so factory start also pays for a TUI it never renders, before it pays the 700 ms Pi import.

## Scope

- Dynamic-import `./tui/index.js` inside the no-arguments branch of `src/cli.ts`, so tsup emits it as its own chunk.
- Check that no command in `src/commands/` imports from `src/tui/` (add a boundary test like `import-boundary.test.ts`).
- Measure before and after and record the numbers in the PR.
- Keep `pnpm build` output working for `launch.entry` of the daemon.

## Technical notes

- `tsup.config.ts` already splits `agent-auth` and `model-catalog` into chunks; the TUI chunk follows the same mechanism.
- Expected result: CLI start near the Commander floor (about 50 to 100 ms), factory start about 0.3 s faster.
