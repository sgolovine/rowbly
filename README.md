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

A Workspace holds Boards, Epics and an Assignee roster.

```sh
rowbly workspaces list
rowbly workspaces create <id> --name <name> [--description <text> | --description-file <path|-> | --edit]
rowbly workspaces show [<id>] [--workspace <id>]
rowbly workspaces edit <id> [--name <name>] [--description <text> | --description-file <path|-> | --edit]
rowbly workspaces delete <id> [--force] [--yes]
```

- `create` writes `workspaces/<id>/workspace.config.json` with an empty roster. An existing id exits 4.
  A missing `--name` is prompted for in an interactive terminal; otherwise the command exits 2.
- `show` prints the name, description, number of Boards, Epics and Assignees, and which levels of the
  Configuration Cascade define Stages and Custom Fields. Without an id it shows the current Workspace.
- `delete` refuses a Workspace with Boards or Epics (exit 4) unless `--force`, which deletes everything
  inside it. It always asks for confirmation; in a non-interactive run pass `--yes`. Deleting the current
  Workspace clears it from the Local State.
<!-- END workspaces -->

<!-- BEGIN assignees -->
### Assignees

Each Workspace has its own roster of Assignees. Every verb takes `--workspace <id>` (or
`ROWBLY_WORKSPACE`); otherwise the current Workspace is used.

```sh
rowbly assignees list
rowbly assignees add <handle> --name <name> [--email <email>]
rowbly assignees edit <handle> [--name <name>] [--email <email>]   # --email "" removes the email
rowbly assignees remove <handle>
```

- Handles are slugs, unique within the Workspace. An email is optional but must be valid; it lets
  Rowbly recognise Me from `git config user.email`.
- `remove` also takes the handle off every Story in the Workspace and warns with the count, e.g.
  `warning: Assignee "sam" removed from 1 story`.
<!-- END assignees -->

<!-- BEGIN boards -->
### Boards

```text
rowbly boards list                                   [--workspace <id>]
rowbly boards create <id> --name <n> --prefix <P> [--description <text>]
rowbly boards show [<id>|<ws>/<id>]                  # effective Stages and Custom Fields, their source level, Stories per Stage
rowbly boards edit <id> [--name <n>] [--description <text>]
rowbly boards delete <id> [--force]                  # confirms; pass --yes when not interactive
```

- The key prefix (`WEB` in `WEB-42`) must be unique across the whole Data Root; a clash exits 4. Lower case is accepted and upper-cased.
- A new Board has no Stage or Custom Field lists of its own: it inherits them through the Configuration Cascade.
- `delete` refuses a Board that has Stories (exit 4) unless `--force`. Deleting the current Board clears it from Local State.
<!-- END boards -->

<!-- BEGIN stages -->
### Stages

```text
rowbly stages list
rowbly stages add <key> --name <n> --category todo|in_progress|done [--before <key>|--after <key>]
rowbly stages edit <key> [--name <n>] [--category <c>]
rowbly stages move <key> (--before <key>|--after <key>|--first|--last)
rowbly stages remove <key> [--move-to <key>]
# every verb also takes: [--board <id>|<ws>/<id>] [--workspace <id>] [--level board|workspace|global]
```

- `--level` picks the Configuration Cascade level to edit. The default is `board` when a Board is in context, otherwise `workspace`.
- Editing a level that has no list of its own first copies the list it inherits, then applies the change. An edit at `workspace` or `global` level applies to every Board that inherits from it; the output lists those Boards.
- `remove` refuses (exit 4) while a Story or Task on an affected Board is in the Stage. `--move-to` moves them first; moved Stories go to the bottom of the target Stage. The last Stage cannot be removed.
- `--json` prints `{ level, items, affectedBoards }` (plus `storiesMoved`/`tasksMoved` for `remove`).
<!-- END stages -->

<!-- BEGIN fields -->
### Custom Fields

```text
rowbly fields list
rowbly fields add <key> --name <n> --type text|number|boolean|date|url|select|multiselect
                  [--options a,b] [--required] [--min <n>] [--max <n>] [--integer] [--description <text>]
rowbly fields edit <key> [--name <n>] [--description <text>] [--required|--optional] [--options a,b]
                  [--min <n>] [--max <n>] [--integer]
rowbly fields remove <key>
# every verb also takes: [--board <id>|<ws>/<id>] [--workspace <id>] [--level board|workspace|global]
```

- Levels and copy-on-write work as for Stages. A field's key and type never change.
- `--options` applies to `select`/`multiselect` and may be repeated or comma-separated; `--min`, `--max` and `--integer` apply to `number`.
- `remove` strips the field's values from every Story on the affected Boards. An edit (for example dropping an option) strips the values that no longer fit. Both print a warning with the count.
- Values are given to Stories as `--field key=value`: `true`/`false`, numbers, `YYYY-MM-DD` dates, absolute http(s) URLs, and comma-separated multiselect values.
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
