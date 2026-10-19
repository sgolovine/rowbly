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
| `pnpm test:unit` | Run the suites that need no CLI build (services, storage, TUI) |
| `pnpm test:cli` | Run the suites that spawn a built CLI; builds the CLIs first |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm bench:plugins` | The opt-in Plugin benchmark ([`test/performance/README.md`](../../test/performance/README.md)) |

Before finishing a change, run `pnpm typecheck`, `pnpm lint` and `pnpm test`.

## Tests

### Projects

`vitest.config.ts` splits the suites into two projects:

- **`unit`**: every suite that needs no build. It runs in-process against temporary Data Roots.
- **`cli`**: every suite that mentions `runCli`, `CLI_PATH` or `FIXTURE_CLI_PATH`. Its global setup (`test/helpers/globalSetup.ts`) builds two CLIs from the current source into a `.test-dist/run-*` folder of the run's own and removes it afterwards: the real CLI, and one whose registry is the fixture Plugins in `test/plugins/fixtures/`. Parallel runs and worktrees are therefore safe, and tests never touch `dist/`.

### Layout

| Folder | Covers |
| --- | --- |
| `test/core`, `test/schemas`, `test/storage`, `test/services`, `test/output`, `test/commands` | Each layer on its own |
| `test/tui` | Screens and the shell, rendered with `ink-testing-library` |
| `test/plugins` | The plugin host, pipeline, loading, the Built-in Plugins, and fixture Plugins that exercise every hook |
| `test/e2e` | Whole-program checks, such as the language test |
| `test/docs` | The tutorial's fixtures and `tutorial.test.ts`, which runs them and checks the guides show them |
| `test/performance` | Read budgets (part of `pnpm test`) and the opt-in benchmark |
| `test/architecture.test.ts` | The source layers, the `node:fs` rule and the Plugin import rules |

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

## Debugging

- `ROWBLY_DEBUG=trace` prints every operation, commit and Plugin callback with its stage, time and outcome to stderr ([Tracing](../plugins/api.md#tracing)). It never records inputs, data or messages.
- `rowbly doctor` reports anything in a Data Root that Rowbly would not write ([Integrity and doctor](../architecture/data-model.md#integrity-and-doctor)).

## Continuous integration and releases

| Workflow | When | What |
| --- | --- | --- |
| `.github/workflows/ci.yml` | Pull requests and pushes to `main` | Three parallel jobs, each installing with the frozen lockfile: **Verify** (typecheck, lint, build, verify the packed package), **Unit tests** (`pnpm test:unit`) and **CLI tests** (`pnpm test:cli`) |
| `.github/workflows/release.yml` | Run by hand with a version bump | Create a GitHub release from `main`, then publish to npm |
| `.github/workflows/check-skills.yml` | Pull requests and releases | Validate the Intent skills in `skills/` (see the Library Skill Maintenance section of [`AGENTS.md`](../../AGENTS.md)) |
