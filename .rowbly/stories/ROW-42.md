---
title: Turn on the Node compile cache at startup
stage: IN_REFINEMENT
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-42
pull_request: null
---

## Goal

`rowbly` enables Node's compile cache as the first action of `src/cli.ts`, so repeated starts of the CLI, the TUI and the factory daemon compile less JavaScript.

## Why

Measured on 2026-11-14 with `NODE_COMPILE_CACHE` set:

| Step | Cold | Warm cache |
| --- | --- | --- |
| `rowbly --version` | 0.42 s | 0.35 s |
| Pi SDK import | 720 ms | 580 ms |

Every worker and skill shell-out to `rowbly --json` pays the startup cost, so the saving compounds.

## Scope

- Call `module.enableCompileCache()` (Node 22.1 or later; `engines` is `>=22.19.0`) at the top of the entry, before other imports take effect. Choose a cache directory under the user's cache dir and handle a read-only location without failing.
- A test or script check that the call is present and that a missing or unwritable directory does not break startup.
- Document the behaviour in `docs/architecture/tooling.md`.

## Technical notes

- Entry: `src/cli.ts`, bundled by `tsup.config.ts` into `dist/cli.js`. The daemon starts from the same entry (`launch.entry`).
- The cache is a performance aid only. Rowbly must behave the same when it is unavailable.
