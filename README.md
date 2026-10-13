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

```sh
rowbly init [--global] [--workspace <id> --workspace-name <name> [--board <id> --board-name <name> --prefix <P>]]
rowbly use [<workspace>[/<board>]] [--clear]
rowbly whoami [<handle>] [--clear]
rowbly config show [--workspace <id>] [--board <id>|<ws>/<id>]
```

- `init` creates `.rowbly/` in the current directory (`~/.rowbly` with `--global`, or the `--root` /
  `ROWBLY_ROOT` path). It writes `rowbly.config.json` with the default Stages and a `.gitignore` that
  keeps `local.json` out of git. An existing Data Root exits 4. With the Workspace and Board flags it
  also creates them and makes them the current context, so later commands need no flags. In an
  interactive terminal it asks for them instead (suggesting the Board id upper-cased as the prefix).
- `use acme/web` stores the current Workspace and Board in `local.json`; `use acme` stores only the
  Workspace. Without a target it prints the current context and where each part came from: a flag,
  the environment (`ROWBLY_WORKSPACE` / `ROWBLY_BOARD`), `local.json`, or the only one there is.
- `whoami` prints Me and whether it came from `local.json` or from the roster email that matches
  `git config user.email`. `whoami <handle>` claims a handle; one missing from the current
  Workspace's roster is stored with a warning.
- `config show` prints the effective Stages and Custom Fields of a Board and the Configuration
  Cascade level each list comes from (`board`, `workspace`, `global` or `default`). `--json` prints
  an `EffectiveBoardConfig`.
- In the TUI, a first-run screen offers to create the Data Root here or globally when none exists.
  The **Context** entry of the `g` palette switches Workspace and Board; press `m` there to pick Me
  from the roster.
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

```text
rowbly stories list [--stage <k>…] [--category todo|in_progress|done] [--open] [--assignee <h|me>…]
                    [--epic <id>|--no-epic] [--label <l>…] [--priority <P>…] [--search <text>]
                    [--sort rank|priority|created|updated|due] [--board <id>] [--all-boards]
rowbly stories create --name <n> [--description <text>|--description-file <path|->|--edit] [--stage <k>]
                      [--assignee <h>…] [--epic <id>] [--priority <P>] [--label <l>…] [--due <YYYY-MM-DD>]
                      [--field key=value …] [--board <id>]
rowbly stories show <KEY>
rowbly stories edit <KEY> [--name <n>] [description flags]
                    [--assignee <h>… | --add-assignee <h>… | --remove-assignee <h>…]
                    [--epic <id> | --no-epic] [--priority <P> | --no-priority]
                    [--label <l>… | --add-label <l>… | --remove-label <l>…]
                    [--due <date> | --no-due] [--field key=value …] [--unset-field <key>…]
rowbly stories move <KEY> <stage> [--top]
rowbly stories rank <KEY> (--before <KEY>|--after <KEY>|--top|--bottom)
rowbly stories delete <KEY>                          # confirms; pass --yes when not interactive
```

- A new Story gets the next Story Key on its Board: the highest existing number plus one. If the highest-numbered Story is deleted, its key is given to the next new Story.
- A new Story goes to the bottom of its Stage (default: the first effective Stage). `createdBy` is Me when Me is in the Workspace roster.
- Story Keys are case-insensitive (`web-2` is `WEB-2`) and need no `--board`: the key prefix finds the Board.
- Repeatable flags (`--assignee`, `--label`, `--stage`, `--priority`, `--field`) may also be comma-separated. `--assignee me` means Me; it exits 2 when Me is not set.
- Assignees must be in the Workspace roster, the Epic must exist in the Workspace, and Custom Field values must fit their field; required fields must have a value. A violation exits 2 and `--json` lists the valid choices in `details` (for example `validHandles`).
- `list` sorts by Stage order then Rank. `--sort priority` puts the most urgent first, `created` the oldest first, `updated` the newest first and `due` the soonest first. `--open` hides Stories in a `done` Stage. `--search` matches name and description, ignoring case.
- `move` places the Story at the bottom of the target Stage, or at the top with `--top`. `rank` reorders a Story within its Stage. Both write only that Story's file.
- `--json` prints Story objects: an array for `list`, one Story for `create`, `show`, `edit`, `move` and `rank`, and `{ deleted }` for `delete`.
<!-- END stories -->

<!-- BEGIN tasks -->
### Tasks

```text
rowbly tasks list <KEY>
rowbly tasks create <KEY> --name <n> [--description <text>|--description-file <path|->|--edit] [--stage <k>]
rowbly tasks show <TASK-ID>
rowbly tasks edit <TASK-ID> [--name <n>] [description flags]
rowbly tasks move <TASK-ID> <stage>
rowbly tasks delete <TASK-ID>                        # confirms; pass --yes when not interactive
```

- Tasks live inside their Story's file. A Task id is the Story Key plus a number (`WEB-42.1`), taken from the Story's `nextTaskNumber`. Ids are never reused: after deleting `WEB-42.3`, the next Task is still `WEB-42.4`.
- A new Task goes into the first effective Stage unless `--stage` is given. The Stage must be one of the Board's effective Stages; `move` to any other Stage exits 2.
- Tasks are listed in creation order and have no Rank.
- Tasks have no Assignees of their own; `show` displays the Story's Assignees.
- Every change updates both the Task's and the Story's `updatedAt`.
- `--json` prints Task objects: an array for `list`, one Task for `create`, `show`, `edit` and `move`, and `{ deleted }` for `delete`.
<!-- END tasks -->

<!-- BEGIN comments -->
### Comments

```text
rowbly comments list <KEY|TASK-ID>
rowbly comments add <KEY|TASK-ID> [--body <text>|--body-file <path|->|--edit]
rowbly comments edit <KEY|TASK-ID> <comment-id> [--body <text>|--body-file <path|->|--edit]
rowbly comments delete <KEY|TASK-ID> <comment-id>   # confirms; pass --yes when not interactive
```

- The target is a Story Key (`WEB-42`) for a Comment on the Story, or a Task id (`WEB-42.1`) for a Comment on that Task.
- The author is Me when Me is in the Workspace roster, otherwise none. Comment ids are 8-character random ids.
- The body comes from exactly one of `--body`, `--body-file` (`-` reads stdin) or `--edit` (`$VISUAL`/`$EDITOR`, fallback `vi`). Without any of them, an interactive run asks for the body; otherwise the command exits 2. An empty body exits 2.
- `list` shows Comments oldest first. `edit` updates the Comment's `updatedAt`.
- `--json` prints Comment objects: an array for `list`, one Comment for `add` and `edit`, and `{ deleted }` for `delete`.
<!-- END comments -->

<!-- BEGIN epics -->
### Epics

An Epic groups Stories across the Boards of one Workspace. A Story links to an Epic through its `epicId` (`stories create/edit --epic <id>`). Epic Progress is the number of its Stories in a `done`-category Stage, judged by each Story's own Board, out of all its Stories.

```text
rowbly epics list [--closed|--all]                 # open Epics by default: Id, Name, Progress, Boards, Closed
rowbly epics create <id> --name <name> [--description <text> | --description-file <path|-> | --edit]
rowbly epics show <id>                             # details, progress, and Stories grouped by Board
rowbly epics edit <id> [--name <name>] [--description <text> | --description-file <path|-> | --edit]
rowbly epics close <id>                            # allowed even with open Stories
rowbly epics reopen <id>
rowbly epics delete <id> [--yes]                   # unlinks its Stories (epicId: null) and warns with the count
```

Every verb takes `--workspace <id>` (default: `ROWBLY_WORKSPACE`, then the current context). In the TUI, open **Epics** from the `g` palette: `enter` opens an Epic, `n` creates one, `a` shows closed Epics. On an Epic, `enter` opens a Story, `e` edits, `c` closes or reopens, and `d` deletes.
<!-- END epics -->

<!-- BEGIN doctor -->
### Doctor

_Not implemented yet._
<!-- END doctor -->

<!-- BEGIN tui -->
### Interactive mode (TUI)

_Not implemented yet._
<!-- END tui -->
