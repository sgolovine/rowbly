---
title: Load the TUI only when rowbly starts without a command
stage: DONE
position: 39
uid: 12398e33-278f-499d-968c-f46a56a90385
createdAt: 2026-11-14T21:25:51.000Z
updatedAt: 2026-11-14T22:29:59.000Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-43
pull_request: https://github.com/sgolovine/rowbly/pull/227
---

## Goal

`rowbly <command>` and the factory daemon must start without loading Ink, React or a TUI screen. Only `rowbly` with no arguments loads the TUI.

Before this work, `src/cli.ts` imported `renderTui` statically. Thus each CLI command loaded the full TUI before Commander parsed the arguments. Measured on 2026-11-14: bare Node starts in 0.02 s, `rowbly --version` in 0.42 s and `rowbly story get` in 0.43 s to 0.48 s. The Story read itself takes tens of milliseconds. Ink alone imports in approximately 270 ms. The factory daemon starts from the same entry, so a factory start also loads a TUI that it does not show, before it loads Pi (approximately 700 ms).

## Current state

Commit `ce2bf1d1` (`perf(cli): load the TUI lazily so CLI commands do not load Ink`, on `main`) did most of the work:

- `src/cli.ts` loads `./tui/index.js` with `await import()` only in the no-arguments branch.
- `src/cli.test.ts` makes sure that `src/cli.ts` has no static import of `ink`, `react` or `./tui/`. It also runs help, `story get` and `status` with `ink`, `react` and `react/jsx-runtime` mocked to throw.
- `docs/architecture/cli.md`, `tui.md` and `testing.md` describe the rule.

This Story completes the work that stays.

## Scope

In scope:

- A static boundary test: no non-test `.ts` or `.tsx` file in `src/commands/` or `src/services/` imports `ink`, `react`, `react/...`, an `ink-*` package or a module in `src/tui/`.
- A check of the `pnpm build` output: the TUI and Ink are in a separate chunk, and `dist/cli.js` does not import them statically.
- Measurements of the start time before and after, recorded in the pull request.
- A short update of the Build section in `docs/architecture/tooling.md` about the TUI chunk.

Not in scope:

- Changes to the start of the factory daemon other than the TUI import (for example the `tsx` loader of `.rowbly/runtime/bin/rowbly` or the Pi import).
- A lazy load of the Commander command modules.
- Changes to the TUI.

## Acceptance criteria

- [ ] `src/cli.ts` has no static import of `ink`, `react` or `./tui/`, and loads `./tui/index.js` only in the no-arguments branch (the existing tests in `src/cli.test.ts` pass).
- [ ] A new Vitest test reads each non-test `.ts`/`.tsx` file under `src/commands/` and `src/services/` and fails if a static import or re-export has the specifier `ink`, `react`, `react/<path>`, `ink-<name>` or a relative path that resolves into `src/tui/`. The test also has a case that shows that the scan finds a forbidden import in a sample text.
- [ ] After `pnpm build`, `dist/cli.js` has no static `import` of `ink` or `react`, and the code of `src/tui/` is in a separate chunk file in `dist/`. A developer examines this with `grep` and writes the result in the pull request.
- [ ] After `pnpm build`, `node dist/cli.js --version` and `node dist/cli.js -C <project> --json story get <id>` work, and `node dist/cli.js` with no arguments in a terminal starts the TUI (a person examines the TUI start).
- [ ] The factory daemon starts from the built entry: `node dist/cli.js -C <test project> --json factory start` followed by `factory status` and `factory stop` works with the `launch.entry` of `dist/cli.js`. Use a temporary test Project, not the live Rowbly Project. If a check cannot run without live credentials, record that in the pull request.
- [ ] The pull request has a table of start times (median of at least 5 runs each) for `--version` and `story get`, before (the parent of `ce2bf1d1`) and after (the branch head), from the built `dist/cli.js`.
- [ ] `docs/architecture/tooling.md` (Build section) says that the TUI is a separate chunk because `src/cli.ts` loads it with a dynamic `import()`. The text is in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Entry: `src/cli.ts`. TUI entry: `src/tui/index.tsx` (`renderTui`).
- Existing test to extend or copy from: `src/cli.test.ts`. It has the `staticImports(source)` helper. You can move the helper to a shared test-only place or copy it. Keep the new test next to the code that it examines, for example `src/commands/tui-boundary.test.ts` or in `src/cli.test.ts`. Follow the dash-case name rule.
- A similar runtime test for Pi: `src/services/pi-runtime/import-boundary.test.ts`.
- Daemon launch: `src/commands/factory/factory.ts` and `src/commands/factory-runner/factory-runner.ts` set `launch.entry` to `resolve(process.argv[1])`. With the build, this is `dist/cli.js`. The daemon runs with arguments, so it does not load the TUI.
- `tsup.config.ts` has no explicit chunk settings. tsup enables code splitting for ESM by default, so each dynamic `import()` (for example `agent-auth` and `model-catalog`) becomes its own chunk. The TUI chunk uses the same mechanism. Do not add config if the default is sufficient.
- At refinement time, the worktree had no `node_modules`. Run `pnpm install` before the checks.
- The `dist/` in the canonical root was older than `ce2bf1d1` (it had Ink in `dist/cli.js`). Do not use it as the "after" result.
- To measure, use `hyperfine` if it is available, or a shell loop with `/usr/bin/time` or `date +%s%N`.

## Assumptions

- The dynamic import in `src/cli.ts` from commit `ce2bf1d1` satisfies the first scope item. This Story does not do it again. Reason: the code and tests on `main` already have it.
- "Before" measurements use a build of the parent of `ce2bf1d1`. Reason: that is the last commit with the static TUI import.
- The boundary test is a static source scan, not a runtime test of each command. Reason: the runtime tests in `src/cli.test.ts` already cover help, `story get` and `status`. A static scan covers all commands with a small, fast test.
- The "factory start about 0.3 s faster" expectation is not an acceptance criterion. Reason: the factory start time depends on Pi, credentials and the machine. The pull request records the CLI start times only, and the factory start time if it is possible without live credentials.
