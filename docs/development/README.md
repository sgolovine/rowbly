# Development

How to build, test and debug Rowbly. Code conventions (TUI file layout, async test rules, the checks to run) are in [`AGENTS.md`](../../AGENTS.md); the source layers are in the [architecture overview](../architecture/overview.md#source-layers).

## Setup

Use the Node.js version in `.nvmrc` and pnpm.

```sh
pnpm install
pnpm dev            # the TUI, run from source
pnpm dev stories list --board web
```

`pnpm dev` runs `src/cli.ts` with tsx and the real Plugin registry. The repository commits its own `.rowbly/` Data Root, so commands work in the checkout.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev <args>` | Run the CLI from source with tsx |
| `pnpm build` | Bundle `src/cli.ts` into `dist/cli.js` with tsup |
| `pnpm typecheck` | `tsc --noEmit` (strict); also compiles the tutorial fixtures in `test/docs/fixtures/` |
| `pnpm lint` | Biome lint and format check (`docs/` is not linted) |
| `pnpm format` | Format with Biome |
| `pnpm test` | Run both Vitest projects, `unit` and `cli` |
| `pnpm test:unit` | Run the suites that need no CLI build (storage, Plugins, TUI, rule checks) |
| `pnpm test:cli` | Run the suites that spawn a built CLI; builds the CLI first |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm bench:plugins` | The opt-in Plugin benchmark ([`test/performance/README.md`](../../test/performance/README.md)) |

Before finishing a change, run `pnpm typecheck`, `pnpm lint` and `pnpm test`.

## Tests

The suite is kept small: a test is required only for the changes listed in [`AGENTS.md`](../../AGENTS.md#tests), and every other change is verified by running it.

### Projects

`vitest.config.ts` splits the suites into two projects:

- **`unit`**: every suite that needs no build. It runs in-process against temporary Data Roots.
- **`cli`**: every suite that mentions `runCli` or `CLI_PATH`. Its global setup (`test/helpers/globalSetup.ts`) builds the CLI from the current source into a `.test-dist/run-*` folder of the run's own and removes it afterwards. Parallel runs and worktrees are therefore safe, and tests never touch `dist/`.

### Layout

| Folder | Covers |
| --- | --- |
| `test/storage` | Atomic writes, the Data Root lock between processes, commit and crash recovery |
| `test/core`, `test/output` | The exit codes and the JSON error shape |
| `test/plugins` | The pipeline's stage order and failures, Plugin loading, Plugin Data kept by core, the operation inventory, and the fixture Plugins they use |
| `test/tui` | Smoke tests of the board, the Story form and terminal restore, and the core key reservations |
| `test/e2e` | The end-to-end CLI scenario and the language test |
| `test/skills` | Task checks for the agent skills in `skills/` |
| `test/docs` | The guides' fixtures and `tutorial.test.ts`, which checks the guides show them and runs the step 10 test example |
| `test/cli.test.ts` | The built CLI opening the TUI in a pseudo-terminal |
| `test/architecture.test.ts` | The source layers, the `node:fs` rule and the Plugin import rules |
| `test/performance` | The opt-in benchmark (not a test suite) |

### Helpers

- `test/helpers`: `tempRoot()` (a throwaway Data Root), `fixedClock()` and `fixedIds()`, the fixture builders `makeRootConfig`, `makeBoard` and `makeStory`, `deferred()` (a promise you release by hand), and `runCli(args, { root, env, stdin, cwd })`, which runs the built CLI in a child process.
- `test/tui/helpers.tsx`: `renderTui()` with a `press(...keys)` helper, `KEYS`, and `waitForFrame(app, text | RegExp | predicate)`, which polls the rendered frame.
- `test/plugins/helpers.ts`: `pluginRoot(entries)` (a Data Root with Plugins turned on), `withPlugins(root, plugins)` (services with those Plugins loaded), `readJsonFile` and `storyFile`.
- `test/plugins/tuiHelpers.tsx`: `openPluginApp(root, plugins, route)` renders the whole TUI with given Plugins; `focusFormField` and `focusListItem` move focus by label.
- `src/plugin-api/testing.ts`: the Plugin test harness, `createPluginTestHost` and `validatePluginDefinition` ([reference](../plugins/api.md#testing)).

### Rules

Wait for what the next action needs, never for a fixed time. The full rules for async and TUI tests are in [`AGENTS.md`](../../AGENTS.md#async-tests).

### Tests that read the docs

| Test | Reads | Keeps true |
| --- | --- | --- |
| `test/plugins/operationInventory.test.ts` | [`docs/architecture/operations.md`](../architecture/operations.md) | The operation tables list every core operation in order, and every built-in operation with its input keys |
| `test/docs/tutorial.test.ts` | [`docs/plugins/writing-a-plugin.md`](../plugins/writing-a-plugin.md), [`docs/plugins/api.md`](../plugins/api.md) | Every `ts`/`tsx` block is a `// #region` of a fixture in `test/docs/fixtures/`, and every region is shown |
| `test/e2e/language.test.ts` | [`docs/agents/CONTEXT-MAP.md`](../agents/CONTEXT-MAP.md) and each `src/plugins/<id>/CONTEXT.md` | Each Built-in Plugin has a glossary with `_Avoid_` words, linked from the map; user-facing text avoids those words |

## Screenshots

Screenshots of the TUI are taken with [agentic-tui](https://github.com/codeboltai/agentic-tui), a
devDependency that runs a command in a PTY and lets a script (or an agent) send keys, wait for text
and save the screen as text, JSON or PNG. `scripts/demo-data-root.sh <dir>` builds the Data Root
they are taken against with the built CLI: one Board with two Stories per Stage, Assignees, Tasks and
a Comment. The steps are in the agent skill `.agents/skills/rowbly-screenshots/SKILL.md`. A PNG shows
the text in one colour, without Stage colours or styling.

`node-pty` is pinned to a 1.2 beta in `pnpm-workspace.yaml`, because 1.1.0 ships no Linux x64
binary; its build script stays off, since the binaries it ships load without it.

## Debugging

- `ROWBLY_DEBUG=trace` prints every operation, commit and Plugin callback with its stage, time and outcome to stderr ([Tracing](../plugins/api.md#tracing)). It never records inputs, data or messages.
- `rowbly doctor` reports anything in a Data Root that Rowbly would not write ([Integrity and doctor](../architecture/data-model.md#integrity-and-doctor)).

## Continuous integration and releases

| Workflow | When | What |
| --- | --- | --- |
| `.github/workflows/ci.yml` | Pull requests, pushes to `main` and manual dispatch | Frozen-lockfile jobs: **Verify** (typecheck, lint, build, verify the packed package), **Unit tests** (`pnpm test:unit`), **CLI tests** (`pnpm test:cli`) and **Clipboard smoke** (macOS, Windows and Ubuntu) |
| `.github/workflows/release.yml` | Run by hand with a version bump | Create a GitHub release from `main`, then publish to npm |

### Clipboard smoke

The clipboard matrix builds Rowbly, runs `npm pack`, and globally installs that tarball with npm.
`scripts/clipboard-smoke.mjs` resolves the installed `dist/clipboard.js` and its native dependency
from `npm root -g`, logging their paths and versions. Every OS must load the installed reader and
native binding, write a small opaque multicolor PNG with `setImageBinary`, and read it through
`readClipboardImage()`. It compares decoded dimensions and RGBA pixels, because clipboard servers
can reencode PNG bytes. The PNG codec is a development dependency; the smoke runs outside Vitest.

Ubuntu runs the native check under Xvfb, then `scripts/clipboard-wayland-smoke.sh` starts a bounded
headless Sway session with no `DISPLAY`. A foreground `wl-copy` owns the real selection; a forwarding
wrapper records the installed reader's real `wl-paste --list-types` and `wl-paste --type image/png`
calls, proving the fallback ran. Sway provides data-control support without a focused helper window.
Writers and the compositor are stopped on completion or failure, and compositor logs are printed.
All load failures, unavailable clipboard results, timeouts and pixel mismatches fail the job; none
are silently skipped. Hosted runner clipboard access failures therefore retain their attempted
round-trip diagnostics alongside the preceding required install/load check.

To reproduce after a build and global tarball install, run:

```sh
node scripts/clipboard-smoke.mjs load
node scripts/clipboard-smoke.mjs native  # macOS or Windows
xvfb-run --auto-servernum node scripts/clipboard-smoke.mjs native  # Linux X11
bash scripts/clipboard-wayland-smoke.sh  # Linux; requires sway and wl-clipboard
```

The manual trigger becomes available once the workflow is on the default branch. A pushed feature
branch alone does not run this matrix; its pull request does.
