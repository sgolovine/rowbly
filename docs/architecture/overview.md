# Architecture overview

## Goals

- **Developer focused.** Rowbly runs in the terminal, next to the code it tracks.
- **Files, not a server.** All data is pretty-printed JSON and Markdown in a `.rowbly/` folder (the Data Root), so a small team shares its tracker through git, with no database and no service ([ADR-0001](../agents/adr/0001-json-files-not-sqlite.md), [ADR-0002](../agents/adr/0002-data-root-discovery.md)).
- **A small core.** Boards, Stories, Stages, Custom Fields and Me are core. Everything else is a Plugin ([ADR-0009](../agents/adr/0009-built-in-plugins-use-only-the-plugin-api.md)).
- **Two surfaces, one feature set.** Every data change works in both surfaces below. The only exception is Plugin Actions, which are TUI keys that open or show something, with the host-owned Git Sync exception in ADR-0035 ([ADR-0017](../agents/adr/0017-actions-are-tui-only.md)).

Out of scope: authentication and authorization. Rowbly is for one person or a small team that already shares a repository.

## Surfaces

| Surface | Started by | Built with |
| --- | --- | --- |
| Command mode | `rowbly <noun> <verb> …`, for example `rowbly stories list` | Commander; `@clack/prompts` asks for missing values when stdin and stdout are terminals |
| Interactive mode (TUI) | `rowbly` with no command | Ink and React: the Kanban board, detail screens and every form ([ADR-0006](../agents/adr/0006-ink-owns-the-interactive-mode.md)) |

Clack never runs inside the TUI: both libraries take over stdin and raw mode. Every list and show command has `--json` output, and errors with `--json` are `{"error":{"code","message","details","hint"?}}` on stderr.

## Technology

| Need | Library |
| --- | --- |
| Language | TypeScript (strict), ESM, Node.js `>=22` (the version in `.nvmrc` for development) |
| Schemas and validation | `zod` |
| Commands | `commander` |
| Prompts in command mode | `@clack/prompts` |
| TUI | `ink`, `react` |
| Markdown in the TUI | `marked` with `marked-terminal` (the renderer `ink-markdown` wraps; its own build cannot load Ink 8), `wrap-ansi` |
| Colour, tables | `picocolors`, `cli-table3` |
| Story Rank | `fractional-indexing` |
| Random ids | `nanoid` |
| Build, run from source | `tsup`, `tsx` |
| Lint and format, tests | Biome, Vitest with `ink-testing-library` |

## Source layers

The source is in layers. Each layer imports only the layers listed for it, and `test/architecture.test.ts` enforces it. Only `src/storage` touches `node:fs`.

| Layer | Path | May import |
| --- | --- | --- |
| Core | `src/core`: errors, ids, Rank, time, repeatable-flag parsing | — |
| Schemas | `src/schemas`: the `zod` schema of every stored record | core |
| Storage | `src/storage`: paths, JSON and text files, the repositories, the lock and the commit journal | core, schemas |
| Services | `src/services`: one service per noun (`boards`, `stories`, `stages`, …), plus the plugin host, the operation runner and the Plugin types in `src/services/plugins/`. Services never print | core, schemas, storage; React, Ink and Commander in types only |
| Output | `src/output`: colours, tables and rendering | core, schemas, services |
| Commands | `src/commands`: the Commander program | the layers above |
| TUI | `src/tui`: the Ink app ([conventions in `AGENTS.md`](../../AGENTS.md#tui-code-organization-srctui)) | the layers above |
| Plugin API | `src/plugin-api`; `tui.ts` may also import the TUI | core, schemas, services, output |
| Plugins | `src/plugins/<id>/` | the Plugin API and their own files only |
| Plugin test harness | `src/plugin-api/testing.ts`, for tests only: no Plugin and no production module imports it | core, schemas, storage, services, main, Plugin API |
| Program | `src/main.ts` | core, storage, services, commands, output, TUI |
| Entry point | `src/cli.ts`, the only reader of the Plugin registry `src/plugins/index.ts` | program, Plugins |

Each command area under `src/commands/` has a `command.ts` for Commander registration and handlers,
a `render.ts` for human-readable output (functions named `renderThing`), and optional `util.ts` and
`types.ts` files. Each area's `index.ts` exports its public interface. The top-level `command.ts`
registers every area; the top-level `index.ts` exports the command API.

## How a command runs

1. `src/cli.ts` hands the Plugin registry to `main` in `src/main.ts`.
2. `main` finds the Data Root (`--data-root`, then the Home Config's default Data Root, then `.rowbly/` in the current directory or a parent, then `~/.rowbly`; [ADR-0033](../agents/adr/0033-known-data-roots-select-the-data-root.md)), loads the Plugins it turns on, and builds the Commander program (or starts the TUI) over one set of services. Plugins load before the program is built, because their commands and options are part of it.
3. A command or screen calls a service. Every change is an **operation**: the service runs its body through `OperationRunner.run`, which fills a Change Set, lets Plugins transform and guard it, saves it once, then runs reactions. See [Operations](operations.md).
4. The save is one journaled commit under the Data Root lock. See [Storage and commits](storage.md).

## Where to go next

- [Data model](data-model.md): the files under `.rowbly/` and what each record holds.
- [Operations](operations.md): the pipeline and every operation's input and result.
- [Storage and commits](storage.md): the lock, the journal and the guarantees.
- [The plugin system](../plugins/README.md).

### Feature flag service

`services.featureFlags.list()` returns registered Experimental Features with their effective
boolean values; `isEnabled(key)` reads one feature. Both read the current Data Root config on each
call. `set(key, enabled)` runs `feature-flags.set` through the coordinated Operation pipeline and
merges into the latest root config through `changes.updateRootConfig`, preserving other settings,
unknown flag keys and Plugin Data. Definitions and defaults live only in
`src/services/featureFlags.ts`; the registry starts empty. Unknown keys are `NotFoundError`.
