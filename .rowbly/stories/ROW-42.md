---
title: Turn on the Node compile cache at startup
stage: DONE
position: 41
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-42
pull_request: https://github.com/sgolovine/rowbly/pull/226
---

## Goal

`rowbly` turns on the Node compile cache as the first action of the process. Then repeated starts of the CLI, the TUI and the factory daemon compile less JavaScript. Each worker and each skill runs `rowbly --json` many times, so the saving adds up.

Measured on 2026-11-14 with `NODE_COMPILE_CACHE` set:

| Step | Cold | Warm cache |
| --- | --- | --- |
| `rowbly --version` | 0.42 s | 0.35 s |
| Pi SDK import | 720 ms | 580 ms |

The cache is only a performance aid. Rowbly must behave the same when the cache is not available.

## Scope

In scope:

- A small bootstrap entry in `src/cli.ts` that turns on the compile cache and then loads the rest of the CLI with a dynamic `import()`.
- A function that selects the cache directory and calls `module.enableCompileCache()`. It never throws and never writes to stdout or stderr.
- Tests for the function, for the bootstrap and for startup with a cache directory that Rowbly cannot write.
- A new section in `docs/architecture/tooling.md`.

Not in scope:

- A user setting or a CLI flag for the cache.
- Calls to `module.flushCompileCache()` in the daemon or the workers.
- Cleanup or a size limit of the cache directory.
- A change to the factory wrapper script in `.rowbly/runtime/bin/rowbly`.

## Acceptance criteria

- [ ] `src/cli.ts` has no static import other than `node:` built-ins and the compile cache module. It calls the compile cache function before it loads the CLI with `await import(...)`. A test in `src/cli.test.ts` examines the source text.
- [ ] The current CLI body (Commander program, `registerCommands`, the TUI branch and the `launch` data) moves to a new dash-case module, for example `src/cli-main.ts`. The TUI stays behind `await import("./tui/index.js")`, and the TUI import boundary tests in `src/cli.test.ts` still pass against the new module.
- [ ] The cache directory is `<user cache dir>/rowbly/compile-cache`. The user cache dir is `$XDG_CACHE_HOME` when it is set to an absolute path. Otherwise it is `~/Library/Caches` on macOS, `%LOCALAPPDATA%` on Windows when it is set, and `~/.cache` on other systems. A unit test examines each case with injected `env`, `platform` and `home` values.
- [ ] The function returns the result of `enableCompileCache` (or a failed status) and does not throw when `enableCompileCache` throws or returns `FAILED`. A unit test with an injected `enableCompileCache` examines this.
- [ ] When `NODE_COMPILE_CACHE` is set, Rowbly does not override it (Node already enabled the cache, or `enableCompileCache` uses the variable). When `NODE_DISABLE_COMPILE_CACHE` is set, the cache stays off. A unit test examines that the function does not pass its own directory when `NODE_COMPILE_CACHE` is set.
- [ ] A child process test starts the built or the `tsx` entry with `XDG_CACHE_HOME` set to a read-only directory and runs `--version` and `--json status` (in a test Project). Both exit with 0, stdout is the same as with a writable cache, and stderr is empty.
- [ ] `pnpm build` makes a `dist/cli.js` that starts. `node dist/cli.js --version` prints the version. After one run, the cache directory contains files (examine with a writable `XDG_CACHE_HOME`).
- [ ] The factory daemon starts from the same entry (`launch.entry`) and gets the cache with no other change. The tests in `src/services/factory/factory.test.ts` still pass.
- [ ] `docs/architecture/tooling.md` has a "Compile cache" section in STE that gives the directory rule, the environment variables and the fact that a failure is silent.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm knip:production` pass.

## Technical notes

- Entry: `src/cli.ts`, bundled by `tsup.config.ts` into `dist/cli.js` (ESM, `target: node22`). tsup keeps the `dependencies` (for example `commander`, `ink`, `react`) external, so Node loads them from `node_modules`. In dev and in the factory wrapper, Node runs `src/cli.ts` through the `tsx` loader.
- Why a bootstrap entry is necessary: Node links and compiles all static ESM imports before the code of a module runs. If `enableCompileCache()` is in the body of the current `src/cli.ts`, `commander` and the command modules are already compiled. Only a dynamic `import()` after the call gets the cache. tsup splits the dynamic import into a chunk; that is acceptable.
- `module.enableCompileCache(dir)` exists from Node 22.8.0 (the old note said 22.1, which is not correct). `engines` is `>=22.19.0`, so no version check is necessary. Status values: `module.constants.compileCacheStatus` has `FAILED`, `ENABLED`, `ALREADY_ENABLED` and `DISABLED`.
- Checked on Node 24.22.1: `enableCompileCache` with a directory that it cannot create returns `{ status: FAILED, message: "Cannot create cache directory: permission denied" }`. It does not throw and does not write to stderr. With `NODE_DISABLE_COMPILE_CACHE=1` it returns `DISABLED`. Keep a `try`/`catch` around the call because other Node versions can act differently.
- Put the function in `src/services/compile-cache/compile-cache.ts` with `compile-cache.test.ts` next to it. Inject `env`, `platform`, `home` and `enableCompileCache` for the tests. The service must not import `commander`, `ink` or `react`, and must not print or exit. See `docs/architecture/service-layer.md` and the `rowbly-code-style` skill.
- Do not load Pi in the bootstrap. Keep the lazy boundary in `src/services/pi-runtime/`.
- `src/cli.test.ts` reads `src/cli.ts` as text because the module runs at import time. Change the test to read both the bootstrap and the new main module.
- The TUI computes `launch.entry` from `process.argv[1]`. With the bootstrap this stays `dist/cli.js` or `src/cli.ts`, so the daemon also runs the bootstrap.

## Assumptions

- The cache directory is `<user cache dir>/rowbly/compile-cache` with the platform rule above. Reason: the author asked for a directory under the user cache dir. This rule follows the XDG and platform conventions, and it does not use the shared `os.tmpdir()` default of Node.
- Rowbly does not override `NODE_COMPILE_CACHE` or `NODE_DISABLE_COMPILE_CACHE`. Reason: a user who sets these variables wants control of the cache.
- A failure of the cache is silent, also without `--json`. Reason: the author said that Rowbly must behave the same without the cache, and a warning would change the stderr of each command.
- No call to `flushCompileCache()` in the long-running daemon. Reason: Node writes the cache when the process exits normally. A flush is an extra optimization, and the smallest scope does not include it.
- The bootstrap is in `src/cli.ts` and the old body moves to a new module, so that `package.json` `bin`, `tsup.config.ts` and `launch.entry` do not change. Reason: this is the smallest change that also caches the modules that the CLI imports statically.
