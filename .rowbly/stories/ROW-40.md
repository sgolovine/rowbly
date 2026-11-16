---
title: Share one Pi ModelRuntime per TUI process
stage: DONE
position: 36
createdAt: 2026-11-14T21:25:48.000Z
updatedAt: 2026-11-14T22:03:37.000Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-40
pull_request: https://github.com/sgolovine/rowbly/pull/223
---

## Goal

`authRuntime()` in `src/services/agent-auth/agent-auth.ts` gives the same `ModelRuntime` to all callers in one process. At this time it creates a new runtime on each call.

The Models tab, the Factory modal and the AI settings section each call `authRuntime()` when they open. `createFactoryRuntime()` in `src/services/pi-runtime/factory-runtime.ts` creates a new `ModelRuntime` on each call. The runtime is cheap (approximately 6 ms), but with one shared runtime, all views see the same credential state after a login or a logout. Also, there is only one place to invalidate the runtime.

## Scope

In scope:

- Keep the runtime promise in a module-level `Store` in `agent-auth.ts`. All calls to `authRuntime()` in one process get the same promise.
- Add an exported reset function (`resetAuthRuntime()`) that removes the cached runtime. The next call to `authRuntime()` creates a new runtime.
- If the creation of the runtime fails, remove the failed promise from the cache. The next call tries again.
- Update the tests of `agent-auth`. Make sure that the view tests and the command tests that mock `authRuntime` continue to pass.

Not in scope:

- `src/commands/factory-runner/factory-runner.ts` calls `createFactoryRuntime()` directly for the daemon. Do not change it.
- No change to `createFactoryRuntime()`.
- No change to the `loadRuntime` props of the views. They continue to use `authRuntime` as the default.

## Acceptance criteria

- [ ] Two calls to `authRuntime()` in one process, also two calls at the same time, call `createFactoryRuntime()` one time and give the same runtime object (unit test with a mock of `../pi-runtime/factory-runtime.js`).
- [ ] After `resetAuthRuntime()`, the next call to `authRuntime()` calls `createFactoryRuntime()` again and gives a new runtime (unit test).
- [ ] When `createFactoryRuntime()` rejects, `authRuntime()` rejects with the same error, and the next call calls `createFactoryRuntime()` again (unit test).
- [ ] The cache uses the `Store` class from `src/services/store/store.ts` and has no module-level `let` (code review and `pnpm lint`).
- [ ] The board, help, doctor, status and history paths do not load Pi: `src/services/pi-runtime/import-boundary.test.ts` passes. `authRuntime()` loads Pi only when a caller calls it, not at import time.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Current code: `export async function authRuntime() { return (await createFactoryRuntime()).runtime; }`.
- Recommended shape: `const shared = new Store<{ runtime?: Promise<AuthRuntime> }>({})`. In `authRuntime()`, give `shared.current.runtime` if it exists. If not, create the promise, keep it in the store, and attach a rejection handler that clears the store only if the store still holds this promise (a reset or a new promise can replace it). `resetAuthRuntime()` sets `runtime` to `undefined`.
- Follow the pattern of the module-level `login` `Store` that `loginProvider` uses for the one-login-at-a-time rule.
- Callers of `authRuntime`: `src/commands/auth/auth.ts`, `src/commands/model/model.ts`, `src/services/factory-settings/factory-settings.ts` (line ~244), `src/tui/screens/factory/factory-modal/factory-modal.tsx`, `src/tui/screens/stories/models-tab/models-tab.tsx` and `src/tui/screens/settings/ai-section/ai-section.tsx` (default `loadRuntime = authRuntime`).
- Tests that mock `authRuntime` with `vi.mock` or `vi.spyOn`: `src/tui/shell/shell/shell.test.tsx`, `src/tui/shell/shell-overlays/shell-overlays.test.tsx`, `src/tui/screens/stories/story-tab-panes/story-tab-panes.test.tsx`, `src/tui/screens/stories/story-modal-body/story-modal-body.test.tsx`, `src/commands/factory/factory.test.ts`, `src/commands/auth/auth.test.ts`. The `vi.mock` factories spread the original module, so a new export `resetAuthRuntime` is available there without a change.
- Tests in `agent-auth.test.ts` that use the real `authRuntime()` must call `resetAuthRuntime()` in `afterEach`, so that one test does not get the runtime of a different test.
- Read the `rowbly-code-style` skill before the change. Use `.js` extensions in relative imports.

## Assumptions

- `logoutProvider` does not call `resetAuthRuntime()`. Reason: the logout runs on the shared runtime, so the shared runtime already has the new credential state. A reset after logout gives new callers a different runtime than the views that are open, and this is the problem that the Story removes. The reset function is available for tests and for a caller that must drop the runtime.
- The CLI commands (`rowbly auth ...`, `rowbly model ...`) also get the shared runtime. Reason: each CLI command is one short process, so a cache has no effect on their behaviour.
- The name of the reset function is `resetAuthRuntime`. Reason: the Story did not give a name, and this name agrees with `authRuntime`.
