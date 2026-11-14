---
title: Share one Pi ModelRuntime per TUI process
stage: IN_REFINEMENT
worktree: null
pull_request: null
---

## Goal

`authRuntime()` in `src/services/agent-auth/agent-auth.ts` gives the same `ModelRuntime` to every caller in one process, instead of a new one on each call.

## Why

The Models tab and the Factory modal each call `authRuntime()` when they open, and `createFactoryRuntime` in `src/services/pi-runtime/factory-runtime.ts` builds a new `ModelRuntime` each time. The runtime itself is cheap (about 6 ms), but a shared one means every view sees the same credential state after a login or logout, and there is one place to invalidate.

## Scope

- Memoise the runtime promise at module level, with a reset for tests and for logout.
- A failed creation must not stay cached.
- Update the tests of `agent-auth` and the views that pass `loadRuntime`.

## Technical notes

- `src/tui/screens/stories/models-tab/models-tab.tsx`, `src/tui/screens/factory/factory-modal/factory-modal.tsx` and `src/tui/screens/settings/ai-section/ai-section.tsx` all take `loadRuntime = authRuntime`.
- `runLogin` uses a module-level `Store` for the one-login-at-a-time rule; follow the same pattern (`Store`, no `let`).
