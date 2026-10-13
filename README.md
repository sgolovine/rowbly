# Rowbly

A developer-focused, file-backed Kanban tracker for the terminal.

Run `rowbly` with no arguments to open the interactive TUI, or `rowbly <noun> <verb> …` to run one command and exit. All data is pretty-printed JSON in a `.rowbly/` Data Root, so a team can share it through git.

## Install

Requires Node.js 22 or newer and pnpm.

```sh
pnpm install
pnpm build
pnpm link --global   # or: npm i -g .
rowbly --help
```

## Develop

| Command | What it does |
| --- | --- |
| `pnpm dev <args>` | Run the CLI from source with tsx |
| `pnpm build` | Bundle `src/cli.ts` into `dist/cli.js` with tsup |
| `pnpm typecheck` | `tsc --noEmit` (strict) |
| `pnpm lint` | Biome lint and format check |
| `pnpm format` | Format with Biome |
| `pnpm test` | Build once, then run vitest |
| `pnpm test:watch` | vitest in watch mode |

The build specification lives in [`docs/spec/`](docs/spec/README.md). Use the terms in [`CONTEXT.md`](CONTEXT.md).

### Tests

- `test/helpers` provides `tempRoot()` (a throwaway `.rowbly/`), `fixedClock()`, `fixedIds()`, fixture builders (`makeWorkspace`, `makeBoard`, `makeStory`, `makeEpic`) and `runCli(args, { root, env, stdin })`, which runs the built `dist/cli.js` in a child process.
- `pnpm test` builds `dist/cli.js` before the suite runs (vitest global setup), so `runCli` always tests the current source.

## Global flags

| Flag | Meaning |
| --- | --- |
| `--root <path>` | Use this Data Root instead of discovering one (also `ROWBLY_ROOT`) |
| `--json` | Machine-readable output on stdout; errors as `{"error":{"code","message","details"}}` on stderr |
| `--yes` | Skip confirmations |
| `--no-prompt` | Never prompt; fail when input is missing |
| `-h, --help` | Show help |
| `-V, --version` | Show the version |

Colour follows `NO_COLOR` and `FORCE_COLOR`.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Internal error |
| 2 | Usage or validation error |
| 3 | Not found |
| 4 | Conflict |
| 5 | No Data Root found |
| 6 | Data integrity error |

## Command reference

<!-- BEGIN setup -->
### Setup: `init`, `use`, `whoami`, `config`

_Not implemented yet._
<!-- END setup -->

<!-- BEGIN workspaces -->
### Workspaces

_Not implemented yet._
<!-- END workspaces -->

<!-- BEGIN assignees -->
### Assignees

_Not implemented yet._
<!-- END assignees -->

<!-- BEGIN boards -->
### Boards

_Not implemented yet._
<!-- END boards -->

<!-- BEGIN stages -->
### Stages

_Not implemented yet._
<!-- END stages -->

<!-- BEGIN fields -->
### Custom Fields

_Not implemented yet._
<!-- END fields -->

<!-- BEGIN stories -->
### Stories

_Not implemented yet._
<!-- END stories -->

<!-- BEGIN tasks -->
### Tasks

_Not implemented yet._
<!-- END tasks -->

<!-- BEGIN comments -->
### Comments

_Not implemented yet._
<!-- END comments -->

<!-- BEGIN epics -->
### Epics

_Not implemented yet._
<!-- END epics -->

<!-- BEGIN doctor -->
### Doctor

_Not implemented yet._
<!-- END doctor -->

<!-- BEGIN tui -->
### Interactive mode (TUI)

_Not implemented yet._
<!-- END tui -->
