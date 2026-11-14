---
title: Run Pi model and auth lookups in a worker thread
stage: IN_DEVELOPMENT
position: 3
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-44
pull_request: null
---

## Goal

The TUI does not block its render thread on the Pi SDK import when it reads the model list or the provider status. A `worker_threads` worker imports the SDK and answers "list models" and "auth status" requests over `postMessage`. The Ink main thread does not import Pi for these reads.

## Why

The import of `@earendil-works/pi-coding-agent` takes 580 to 720 ms (measured 2026-11-14). ROW-39 (on-disk cache), ROW-40 (shared runtime) and ROW-41 (preload) are done. The import still runs on the Ink main thread in these cases, and it freezes input and rendering:

- The preload of ROW-41 (`preloadPi` in `src/services/pi-runtime/pi-runtime.ts`, called from `src/cli.ts`) imports Pi on the main thread 500 ms after the board shows.
- The Models tab (`refreshWhenStale` in `use-models-tab.ts`) and the Factory modal (`piProviderReady` in `factory-modal.tsx`) load Pi through `authRuntime()` when the cache is stale or missing.

A worker removes these freezes.

## Scope

In scope:

- A worker entry `src/services/pi-runtime/pi-worker.ts`. It imports Pi and answers two requests: `models` (the result of `listAvailableModels`) and `authStatus` (the result of `getAuthStatus`). It sends plain JSON data (no class instances, no credentials).
- A client `src/services/pi-runtime/pi-worker-client.ts`. It has no static import of Pi. It gives a read-only source, for example `piWorkerSource(): PiCatalogSource` with `listAvailableModels()` and `getAuthStatus()`, each a `Promise`.
- Worker lifecycle in the client, in a module-level `Store` (no module-level `let`):
  - Start the worker on the first request, not at import.
  - Call `unref()` on the worker, so that it does not keep the process alive.
  - `stopPiWorker()` terminates the worker. `src/cli.ts` calls it after `renderTui` resolves (TUI exit).
  - When the worker exits or sends `error`, reject all pending requests with an error, and forget the worker. The next request starts a new worker (restart after a crash).
  - Each request has an id. The client matches the reply to the request by id.
- `src/services/pi-catalog-cache/pi-catalog-refresh.ts`: `refreshPiCatalog`, `loadPiCatalog` and `piProviderReady` take a `PiCatalogSource` (the two read functions) in place of an `AuthRuntime`. Add a small adapter `runtimeSource(runtime: AuthRuntime): PiCatalogSource` for the main-thread runtime.
- The Models tab and the Factory modal use the worker source by default. Their test props (`loadRuntime`, `checkProvider`) stay, or change to a source loader with the same purpose. Tests give a faux source.
- The TUI preload (`preloadPiSdk` in `src/cli.ts`) starts the worker (for example a `warmPiWorker()` that sends one cheap request and ignores a failure). It does not import Pi on the main thread.
- The AI settings section continues to use the main-thread `authRuntime()` for status, login and logout. `loadStatus` in `ai-actions.ts` uses `runtimeSource(runtime)` with the new `refreshPiCatalog` signature.
- `tsup.config.ts`: add `src/services/pi-runtime/pi-worker.ts` as a second entry, so that `dist/pi-worker.js` exists next to `dist/cli.js`. Keep `@earendil-works/pi-coding-agent` external.
- Tests with a faux worker (see the acceptance criteria). `import-boundary.test.ts` continues to pass.
- Documentation: update the Pi section of `docs/architecture/native-factory/pi-runtime-and-auth.md` (and `service-layer.md` if it describes the preload) for the worker, in STE.

Not in scope:

- Login and logout. They stay on the main thread, because Pi prompts in the terminal.
- The AI settings section moving to the worker. It still loads Pi on the main thread when the user opens it.
- The CLI commands (`rowbly auth`, `rowbly model`, `rowbly factory configure`) and the factory daemon. They continue to use `authRuntime()` or `createFactoryRuntime()` on the main thread.
- A change to the cache file format of ROW-39.

## Acceptance criteria

- [ ] `pi-worker-client.ts` has no runtime import of `@earendil-works/*` (only type imports). A test in `import-boundary.test.ts`, with the Pi mock that throws, imports the client module without an error.
- [ ] A client unit test with a faux worker (an injected worker factory, for example `createWorker: () => WorkerLike`) shows: no worker starts at import; the first request starts one worker; two requests at the same time use the same worker; each reply goes to the request with the same id.
- [ ] A client unit test shows: when the faux worker emits `error` or `exit`, each pending request rejects, and the next request starts a new worker.
- [ ] A client unit test shows that `stopPiWorker()` terminates the worker and rejects pending requests, and that a later request starts a new worker.
- [ ] A worker-handler unit test (the request handler of `pi-worker.ts`, exported as a function that takes a faux runtime loader) answers `models` and `authStatus` with the same data as `listAvailableModels` and `getAuthStatus`, and answers an error message (no stack, no credential text) when the loader rejects.
- [ ] The worker creates a new `ModelRuntime` for each request (or each time the `piCatalogKey` changes), so that a login or logout in the main thread or in a different process shows in the next answer. A unit test shows that two requests after a change of credentials give the new data.
- [ ] `pi-catalog-refresh.test.ts` passes with a faux `PiCatalogSource`, and a test shows that `runtimeSource(runtime)` gives the same data as the old runtime path.
- [ ] A Models tab test and a Factory modal test with a stale or missing cache use the injected faux source, refresh the cache and never call `authRuntime`.
- [ ] `src/cli.ts`: the TUI branch passes a preload that starts the worker and calls `stopPiWorker()` after `renderTui` resolves. The CLI branch does not import the client (code review; the import-boundary tests pass).
- [ ] After `pnpm build`, `dist/pi-worker.js` exists. A person can examine this: run `node dist/cli.js` in a Project, open the Models tab of a Story with no cache file (`~/.cache/rowbly/pi-catalog.json` removed), and see that the cursor and the keys stay responsive while the models load.
- [ ] No test starts a real Pi model or uses live credentials. No production faux-provider flag is added.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` (including knip if it runs in lint or CI) and `pnpm build` pass.

## Technical notes

- Pi boundary: `src/services/pi-runtime/`. Keep `pi-worker.ts` and `pi-worker-client.ts` in this folder. The board, help, doctor, status and history paths must not load Pi.
- The worker reuses `createFactoryRuntime()` (`factory-runtime.ts`) and `listAvailableModels` / `getAuthStatus` from `src/services/agent-auth/agent-auth.ts`. Do not copy the mapping code.
- Worker URL: in `dist/`, the client code is in a chunk next to `cli.js`, so `new URL("./pi-worker.js", import.meta.url)` resolves to `dist/pi-worker.js`. In `pnpm dev` (`tsx src/cli.ts`), the file is `pi-worker.ts` next to the client. Resolve the file name from the extension of `import.meta.url`, and pass `execArgv: process.execArgv` so that the tsx loader applies in the worker. Confirm in the build that the chunk and `pi-worker.js` are in the same folder.
- If the worker cannot start (for example the file is missing), the request rejects. The existing error paths of the Models tab and the Factory modal show the error only when no cached data exists (ROW-39 rule). Do not fall back to a main-thread import, because that brings back the freeze.
- Message shapes (suggested): request `{ id: number, kind: "models" | "authStatus" }`; reply `{ id, ok: true, data }` or `{ id, ok: false, message }`. Do not send an `Error` object or a stack, so that no credential text crosses the boundary.
- Current callers to change: `src/tui/screens/stories/models-tab/use-models-tab.ts` (`refreshWhenStale`), `src/tui/screens/stories/models-tab/models-tab.tsx` (default `loadRuntime = authRuntime`), `src/tui/screens/factory/factory-modal/factory-modal.tsx` (`modalInput`, `checkProvider`), `src/tui/screens/settings/ai-section/ai-actions.ts` (`loadStatus`), `src/cli.ts` (`preloadPiSdk`).
- `preloadPi` in `pi-runtime.ts` can stay for other users or go if nothing uses it (knip reports unused exports).
- Tests that mock `authRuntime` (`shell.test.tsx`, `shell-overlays.test.tsx`, `story-tab-panes.test.tsx`, `story-modal-body.test.tsx`) must not start a real worker. Give them a faux source, or make sure that they do not reach the default loader.
- Read `.agents/skills/rowbly-code-style/SKILL.md` and `.agents/skills/rowbly-tui-design/SKILL.md` before the change. Use `.js` extensions in relative imports. Each new module gets a test next to it.
- Related: ROW-39, ROW-40, ROW-41 (done).

## Assumptions

- The freeze is still noticeable after ROW-39 and ROW-41, so the hold in the original text does not apply. Reason: the ROW-41 preload imports Pi on the main thread by design, and a stale or missing cache still loads Pi on the main thread.
- The worker creates a new `ModelRuntime` for each request in place of a reload message after login. Reason: `ModelRuntime.create` costs about 12 ms off the main thread, and this also sees a login of a different process (for example `rowbly auth login` in a different terminal). It removes the need to keep the two runtimes in agreement.
- The preload starts the worker and no longer imports Pi on the main thread. Reason: the goal of the Story is no Pi import on the render thread for reads. The AI settings section then pays the main-thread import when the user opens it, and this is accepted because it needs the runtime for login and logout.
- The AI settings section stays on the main-thread runtime. Reason: smallest scope; the Story keeps login and logout on the main thread, and the section uses one runtime for status and for login.
- No main-thread fallback when the worker fails. Reason: a fallback brings back the freeze, and the cache and the existing error paths already cover a failed load.
- The read-only subset is a new `PiCatalogSource` interface with two functions, not a `Pick` of `AuthRuntime`. Reason: the worker answers whole results, not the low-level runtime methods.
