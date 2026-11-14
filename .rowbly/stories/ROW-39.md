---
title: Cache Pi model list and provider auth status on disk
stage: IN_REFINEMENT
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-39
pull_request: null
---

## Goal

The Models tab of the Story Modal and the Factory modal open without loading the Pi SDK. They read a small cache of the available models (with thinking levels) and of the configured providers, and refresh it in the background.

## Why

Measured on 2026-11-14: `import("@earendil-works/pi-coding-agent")` takes about 720 ms cold and about 580 ms with a warm compile cache. `ModelRuntime.create` plus `getAvailable` take 12 ms. The import runs on the Ink main thread, so the TUI freezes the first time a Pi-backed view opens. The answers Pi gives (model list, provider status) change only when the user logs in or out.

## Scope

- A cache file outside `.rowbly/` (for example under the Rowbly home dir), keyed by the mtime of Pi's credential store, with the output of `listAvailableModels` and `getAuthStatus`.
- `use-models-tab.ts` and `factory-modal.tsx` read the cache first and show it at once. A background load through Pi refreshes the cache and the view when the key is stale.
- Login and logout in `src/services/agent-auth/agent-auth.ts` invalidate the cache.
- Tests for the cache service and for the two views with a faux loader.

Not in scope: changing how the factory daemon loads Pi.

## Technical notes

- Pi boundary: `src/services/pi-runtime/`. The cache service must not import Pi; it stores plain JSON. Keep the board, help, doctor, status and history paths free of Pi.
- Callers today: `src/tui/screens/stories/models-tab/use-models-tab.ts` (`loadAfterShown`), `src/tui/screens/factory/factory-modal/factory-modal.tsx` (`hasProvider`), `src/tui/screens/settings/ai-section/`.
- Related: the Stories for sharing one runtime per process and preloading Pi after first paint. This Story makes those a warm-up only.
- Do not keep live credentials in tests.
