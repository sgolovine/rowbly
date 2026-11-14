---
title: Load the TUI lazily so CLI commands do not pay for Ink
stage: BACKLOG
worktree: null
pull_request: null
---

## Problem

`src/cli.ts` imports `renderTui` from `./tui/index.js` statically. Every CLI command loads Ink, React and every TUI screen before Commander parses the arguments, even though only bare `rowbly` renders the TUI.

## Evidence

| Command | Wall time |
| --- | --- |
| `node -e 0` | 0.02 s |
| `rowbly --version` | 0.42 s |
| `rowbly story get ROW-1 --json` | 0.43 to 0.48 s |

`import("ink")` alone takes about 270 ms. Factory workers and skills shell out to `rowbly --json`, so every agent call pays this cost.

## Proposed fix

- Load the TUI with a dynamic `import()` only in the no-arguments branch of `src/cli.ts`.
- Make sure tsup puts the TUI in its own chunk, so the CLI path does not parse it.
- Check that no CLI command module imports `ink`, `react` or a file in `src/tui/`.

## Acceptance

- `rowbly --version` and `rowbly story get <id> --json` complete in under 150 ms on this machine.
- Bare `rowbly` still opens the TUI.
- A test or a lint check fails when the CLI path imports Ink statically.
