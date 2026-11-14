---
title: Load the TUI lazily so CLI commands do not pay for Ink
stage: IN_DEVELOPMENT
position: 1
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-35
pull_request: null
---

## Goal

`src/cli.ts` imports `renderTui` from `./tui/index.js` statically. Each CLI command loads Ink, React and all TUI screens before Commander parses the arguments. Only bare `rowbly` renders the TUI. Factory workers and skills run `rowbly --json` for each agent call, so each call pays this cost.

The user gets faster CLI commands. Bare `rowbly` still opens the TUI.

### Evidence

| Command | Wall time |
| --- | --- |
| `node -e 0` | 0.02 s |
| `rowbly --version` | 0.42 s to 0.49 s |
| `rowbly story get ROW-1 --json` | 0.43 s to 0.48 s |
| `import("ink")` alone | about 0.27 s to 0.37 s |
| `commander`, `gray-matter`, `yaml` and `zod` together | about 0.14 s |
| `commander`, `gray-matter`, `yaml`, `zod`, `chalk` and `@clack/prompts` together | about 0.16 s |

The current `dist/cli.js` is one 826 KB file that imports `ink`, `react` and `react/jsx-runtime` at the top.

## Scope

In scope:

- Load `./tui/index.js` with a dynamic `import()` only in the no-arguments branch of `src/cli.ts`.
- Make sure that tsup puts the TUI in a separate chunk, so that the CLI path does not parse or load it. tsup already splits dynamic imports for ESM (see `agent-auth-*.js` and `model-catalog-*.js` in `dist/`). Set `splitting: true` in `tsup.config.ts` only if the build does not split the TUI.
- A test that fails when the CLI path loads Ink, React or a TUI module.

Not in scope:

- Lazy loading of `@clack/prompts` in `src/commands/init-wizard/` and `src/commands/auth-wizard/`. It costs a small amount of time. A different Story can do it.
- Changes to the other runtime dependencies (`zod`, `gray-matter`, `yaml`, `commander`).

## Acceptance criteria

- [ ] `src/cli.ts` has no static import of a module in `src/tui/`. It loads `./tui/index.js` with `await import(...)` only when `process.argv.length <= 2`.
- [ ] After `pnpm build`, `dist/cli.js` has no static import of `ink`, `react` or `react/jsx-runtime`. A command such as `grep -E 'from "(ink|react)' dist/cli.js` gives no result. The TUI code is in a separate chunk in `dist/`.
- [ ] A Vitest test mocks `ink` (and `react`) so that a load throws an error, like `src/services/pi-runtime/import-boundary.test.ts` does for Pi. The test runs `createProgram().helpInformation()`, `--json story get <id>` and `--json status` through `src/commands/test-cli/test-cli.ts` and passes. The test also makes sure that `src/cli.ts` does not import `ink`, `react` or `./tui/` statically (for example, a check of the source text of `src/cli.ts`). The test fails if a static import is added again.
- [ ] `node dist/cli.js --version` and `node dist/cli.js -C <project> --json story get <id>` are at least 0.2 s faster than before the change on the same machine (target: 0.25 s or less, from about 0.45 s). A person examines this with `time`.
- [ ] Bare `rowbly` (`node dist/cli.js` with no arguments) still opens the TUI, and the Factory controls still get the `launch` values (`process.execPath`, `process.execArgv`, the resolved entry). A person examines this in a terminal, or with the `rowbly-screenshots` skill.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm knip` pass.

## Technical notes

- Entry: `src/cli.ts`. TUI entry: `src/tui/index.tsx` (`renderTui`). Build: `tsup.config.ts` (ESM, entry `src/cli.ts`).
- No module in `src/commands/` or `src/services/` imports `ink`, `react` or `src/tui/` now. Only `src/cli.ts` does. Keep it this way.
- Use the existing Pi boundary test `src/services/pi-runtime/import-boundary.test.ts` as the pattern. Put the new test next to the code that it examines, for example `src/cli.test.ts` or `src/commands/test-cli/tui-import-boundary.test.ts`. Do not import `src/cli.ts` in a test, because it parses `process.argv` and runs at import time.
- The factory daemon starts with the same entry file (`launch.entry`). It also gets faster.
- Update `docs/architecture/testing.md` (the `import-boundary` paragraph) and `docs/architecture/tui.md` or `cli.md` if they say how `src/cli.ts` loads the TUI. Write the text in STE.
- Obey the code style skill: `.js` extensions in relative imports, dash-case names.

## Assumptions

- The time criterion is "at least 0.2 s faster, target 0.25 s or less" and not "under 150 ms". Reason: the other dependencies of the CLI path (`commander`, `zod`, `gray-matter`, `yaml`, `chalk`, `@clack/prompts`) take about 0.16 s to load on this machine without Ink. Under 150 ms is not possible without more changes that are not in the intent of this Story.
- A source check of `src/cli.ts` plus a mocked-`ink` test of the command path is sufficient as the "test or lint check". Reason: it uses the existing pattern of the Pi boundary test and does not need a new lint tool.
- Lazy loading of `@clack/prompts` is not in scope. Reason: the Story is about Ink and the TUI, and the smallest scope agrees with the intent of the author.
