---
title: Run Pi model and auth lookups in a worker thread
stage: IN_REFINEMENT
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-44
pull_request: null
---

## Goal

The TUI never blocks its render thread on the Pi SDK import. A `worker_threads` worker imports the SDK and answers "list models" and "auth status" requests over `postMessage`.

## Why

Even with an on-disk cache and a preload, the one-time 580 to 720 ms import runs on the Ink main thread and freezes input and rendering. A worker removes the freeze. Hold this Story until the cache Story is in and the freeze is still noticeable; it is the most code of the Pi improvements.

## Scope

- A worker entry that loads Pi and serves `listAvailableModels` and `getAuthStatus` requests. Login and logout stay on the main thread, because they prompt in the terminal.
- `authRuntime` callers that only read use the worker client; the `AuthRuntime` type may need a read-only subset.
- Worker lifecycle: start on first use, terminate on TUI exit, restart after a crash.
- Tests with a faux worker; `import-boundary.test.ts` keeps passing.

## Technical notes

- Pi boundary: `src/services/pi-runtime/`. The worker file must be bundled as a separate entry in `tsup.config.ts` so `new Worker(url)` resolves in `dist/`.
- Credential writes after a login happen in the main-thread runtime; the worker must reload or be restarted after login so both sides agree.
- Depends on the decisions of the cache Story and the shared-runtime Story; refine them first.
