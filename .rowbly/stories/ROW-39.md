---
title: Cache Pi model list and provider auth status on disk
stage: DONE
position: 38
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-39
pull_request: https://github.com/sgolovine/rowbly/pull/225
---

## Goal

The Models tab of the Story Modal and the Factory modal open without loading the Pi SDK. They read a small cache file of the available models (with thinking levels) and of the configured providers, and show it at once. When the cache is stale or missing, a background load through Pi refreshes the cache and the view.

## Why

Measured on 2026-11-14: `import("@earendil-works/pi-coding-agent")` takes about 720 ms cold and about 580 ms with a warm compile cache. `ModelRuntime.create` plus `getAvailable` take 12 ms. The import runs on the Ink main thread, so the TUI freezes the first time a Pi-backed view opens. The answers that Pi gives (model list, provider status) change only when the user logs in or out, or edits the Pi model config.

## Scope

In scope:

- A new service `src/services/pi-catalog-cache/pi-catalog-cache.ts` (plain JSON, no Pi import) that reads, writes and deletes the cache file, and computes the cache key.
- The cache file is outside `.rowbly/`: `<home>/.cache/rowbly/pi-catalog.json`, where `<home>` is `ctx.home ?? os.homedir()`.
- The cache holds the output of `listAvailableModels(runtime)` (all providers) and of `getAuthStatus(runtime)`, plus the key and a format version.
- The key is the mtime (ms, or `null` if the file is missing) of `<agentDir>/auth.json` and `<agentDir>/models.json`, plus the Rowbly package version. `<agentDir>` is `$PI_CODING_AGENT_DIR` (with `~` expanded) or `<home>/.pi/agent`, computed without loading Pi.
- A service function (for example `refreshPiCatalog(runtime, ctx)`) that loads both answers through a runtime and writes the cache.
- `use-models-tab.ts`: when the tab is shown, read the cache first and show its models at once. If the cache is missing or stale, load the runtime in the background, refresh the cache, then update the models in the view.
- `factory-modal.tsx` (`providerReady`): read the cache first and answer from it. If the cache is missing or stale, load through Pi, refresh the cache and answer from the fresh data.
- `use-ai-section.ts` / `ai-actions.ts` (`loadStatus`): after it loads the status through Pi, write the cache. The AI section still loads Pi, because it needs the runtime for login and logout.
- `loginProvider` and `logoutProvider` in `src/services/agent-auth/agent-auth.ts` delete the cache file after the attempt (success or failure). `logoutProvider` gets an optional `ctx: ServiceContext` argument, and its callers (`src/commands/auth/auth.ts`, `ai-actions.ts`) pass it.
- Tests for the cache service, and for the Models tab and the Factory modal with a faux loader and a temp `home`.

Not in scope:

- A change to how the factory daemon loads Pi.
- Preloading Pi after first paint (ROW-41) and a worker thread for Pi (ROW-44).
- Detection of provider API keys in environment variables that change between runs (see Assumptions).

## Acceptance criteria

- [ ] `pi-catalog-cache.ts` does not import `@earendil-works/*` or `src/services/pi-runtime/` at runtime. A test in `import-boundary.test.ts` (with the Pi mock that throws) reads and writes the cache without an error.
- [ ] A unit test shows that a written cache reads back the same models and providers when the key is unchanged.
- [ ] A unit test shows that the read gives "stale" (or no data) when the mtime of `auth.json` or `models.json` changes, when one of the files appears or goes away, or when the Rowbly version changes.
- [ ] A unit test shows that a corrupt or wrong-format cache file reads as missing and does not throw.
- [ ] The cache is written atomically with `writeFileAtomic` from `src/services/files/files.ts`, and the parent folder is created when it is missing.
- [ ] A Models tab test with a fresh cache shows the cached models and never calls `loadRuntime`.
- [ ] A Models tab test with a stale or missing cache shows the cached models (if any) first, calls `loadRuntime` one time, then shows the refreshed models, and the cache file holds the new data.
- [ ] A Factory modal test with a fresh cache that has a configured provider answers "provider ready" without a call to the Pi loader. A test with a missing cache calls the loader and writes the cache.
- [ ] A test of `loginProvider` and of `logoutProvider` with a faux runtime shows that the cache file is deleted after the call.
- [ ] No test writes to the real home directory or uses live credentials.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Pi boundary: `src/services/pi-runtime/`. The cache service stores plain JSON and must not import Pi. The board, help, doctor, status and history paths must stay free of Pi (`src/services/pi-runtime/import-boundary.test.ts`).
- `agent-auth.ts` has only type imports from Pi plus a lazy `createFactoryRuntime`; keep it that way. The data types of the cache can be `Awaited<ReturnType<typeof listAvailableModels>>` and `Awaited<ReturnType<typeof getAuthStatus>>`.
- Pi's credential store is `<agentDir>/auth.json`; custom models are in `<agentDir>/models.json`. Pi computes `agentDir` in `getAgentDir()` of `pi-coding-agent/dist/config.js`: env `PI_CODING_AGENT_DIR`, else `~/.pi/agent`. Copy this rule into the cache service; do not import Pi to get it. Let tests override the agent dir (for example an optional argument, or `ctx.home`).
- Callers today: `src/tui/screens/stories/models-tab/use-models-tab.ts` (`loadAfterShown`, `loadModels`), `src/tui/screens/factory/factory-modal/factory-modal.tsx` (`providerReady`, prop `checkProvider` for tests), `src/tui/screens/settings/ai-section/ai-actions.ts` (`loadStatus`, sign-out at about line 137), `src/tui/screens/settings/auth-flow/auth-session.ts` (login), `src/commands/auth/auth.ts` (CLI login/logout).
- The Models tab still loads nothing before it is shown the first time.
- A failure of the background refresh does not remove cached data from the view. Show the existing error path only when there is no cached data.
- Read `.agents/skills/rowbly-code-style/SKILL.md` and `.agents/skills/rowbly-tui-design/SKILL.md` before the change. Each new service gets a test next to it.
- Related Stories: ROW-41 (preload Pi after first paint) and ROW-44 (Pi in a worker thread). This Story makes them a warm-up only.
- Do not keep live credentials in tests.

## Assumptions

- The cache path is `<home>/.cache/rowbly/pi-catalog.json`, without `XDG_CACHE_HOME`. Reason: Rowbly has no home folder today (only `~/.rowblyrc.json`), and `ctx.home` lets tests use a temp folder. The smallest scope that keeps the file outside `.rowbly/`.
- The key also includes `models.json` and the Rowbly version, not only `auth.json`. Reason: a custom model in `models.json` or a new Pi version in a Rowbly upgrade changes the model list.
- A fresh cache does not start a background load. Reason: the goal is to not load Pi. A provider API key set in an environment variable is not part of the key; the AI settings section always loads Pi and rewrites the cache, so the user can refresh there.
- Login and logout delete the cache file, also when the attempt fails. Reason: a failed attempt can still change `auth.json`, and a delete is safe because the next view loads through Pi.
- The AI settings section does not read the cache. It only writes it. Reason: it needs the Pi runtime for login and logout, and the Story scope names only the Models tab and the Factory modal as readers.
