# Rowbly

A developer-focused, file-backed Kanban tracker for the terminal.

Rowbly keeps Workspaces, Boards, Stories, Tasks, Epics and Comments as pretty-printed JSON files in a `.rowbly/` folder, so a small team can keep its tracker inside a code repository and share it through git, with no server and no database. Use it in two ways, with the same features in both:

- `rowbly` with no command opens a full-screen interactive app (the TUI) with a Kanban board, detail views and forms.
- `rowbly <noun> <verb> …` runs one command and exits, for scripts and quick edits. Every list and show command has `--json` output.

## Install

Requires Node.js 22 or newer and pnpm.

```sh
git clone <this repository> rowbly
cd rowbly
pnpm install && pnpm build && pnpm link --global   # or: npm i -g .
rowbly --version
```

`pnpm link --global` puts `rowbly` on your `PATH`. Rowbly is not published to npm.

## Quick start

```sh
cd my-project
rowbly init --workspace acme --workspace-name Acme --board web --board-name Website --prefix WEB
rowbly use acme/web                  # init already did this; use it to switch later
rowbly stories create --name "Login page" --priority P1
rowbly                               # open the board in the TUI
```

`init` creates `.rowbly/` in the current directory with a Workspace `acme` and a Board `web` whose Stories are keyed `WEB-1`, `WEB-2`, …. In a terminal, `rowbly init` with no flags asks for the same values. Run `rowbly whoami <handle>` after `rowbly assignees add <handle> --name <name>` to set Me, the author of your Stories and Comments.

## Concepts

The exact meaning of each term is in [`CONTEXT.md`](CONTEXT.md). In short:

- A **Data Root** (`.rowbly/`) holds everything.
- A **Workspace** holds **Boards**, **Epics** and an **Assignee** roster.
- A **Board** holds **Stories**. Each Story has a **Story Key** made of the Board's key prefix and a number (`WEB-42`), sits in one **Stage**, and has a **Rank** inside that Stage. A Story never moves to another Board.
- A Story has a name, a markdown description, Assignees, an optional Epic, a **Priority** (`P0` most urgent to `P4`), **Labels**, a due date, **Custom Field** values, embedded **Tasks** (`WEB-42.1`) and **Comments**.
- Each Stage belongs to a **Stage Category**: `todo`, `in_progress` or `done`. **Epic Progress** is the share of an Epic's Stories in a `done` Stage.
- **Me** is the Assignee you claim with `rowbly whoami`. It and the current Workspace and Board are **Local State**, kept in `.rowbly/local.json`, which is never committed.

## Data Root and git workflow

Rowbly looks for `.rowbly/` in the current directory and then in each parent, like git looks for `.git`. If it finds none it uses `~/.rowbly` (create it with `rowbly init --global`). `--root <path>` or `ROWBLY_ROOT` names a Data Root directly.

```text
.rowbly/
  rowbly.config.json                 # global configuration
  local.json                         # Local State (git-ignored)
  workspaces/<workspace>/
    workspace.config.json            # name, roster, optional Stages / Custom Fields
    epics/<epic>.json
    boards/<board>/
      board.config.json              # name, key prefix, optional Stages / Custom Fields
      stories/<KEY>.json             # one Story with its Tasks and Comments
```

Commit `.rowbly/` with your code; `init` writes a `.gitignore` that keeps `local.json` out. Each Story is its own file and an Epic link lives on the Story, so most changes touch one small file and merge cleanly.

- **Story Keys** are the highest number on the Board plus one. There is no shared counter, so two branches can both create `WEB-7`. After such a merge, run `rowbly doctor --fix`: it keeps the earlier Story as `WEB-7` and renumbers the other one (and its Task ids). Update branch names or commit messages that used the renumbered key.
- **Deleted keys may be reused.** If the highest-numbered Story is deleted, the next new Story gets its number. git history still shows which Story a key meant at any time.
- **Run `rowbly doctor` after every merge** that touched `.rowbly/`. It reports conflict markers, invalid files, references to Stages, Assignees or Epics that no longer exist, and other drift, and `--fix` repairs what is safe to repair. See [Doctor](#doctor).

## Configuration Cascade

Stages and Custom Fields are configuration, not data. Each list can be defined at three levels:

1. `rowbly.config.json` (global),
2. `workspace.config.json` (Workspace),
3. `board.config.json` (Board).

A Board uses the most specific level that defines the list; the lists are not merged. With no list anywhere, a Board has the built-in Stages `backlog` (Backlog, todo), `todo` (Todo, todo), `in-progress` (In Progress, in_progress) and `done` (Done, done), and no Custom Fields.

`stages` and `fields` commands take `--level board|workspace|global` (default: `board` when a Board is in context, otherwise `workspace`). Changing a level that has no list of its own first copies the list it inherits to that level, then applies the change. A change at `workspace` or `global` level applies to every Board that inherits from it. `rowbly config show` prints a Board's effective lists and the level each one comes from.

## Global flags

| Flag | Meaning |
| --- | --- |
| `--root <path>` | Use this Data Root instead of discovering one (also `ROWBLY_ROOT`) |
| `--json` | Machine-readable output on stdout; errors as `{"error":{"code","message","details"}}` on stderr |
| `--yes` | Skip confirmations |
| `--no-prompt` | Never prompt; fail when input is missing |
| `-h, --help` | Show help |
| `-V, --version` | Show the version |

`ROWBLY_WORKSPACE` and `ROWBLY_BOARD` stand in for `--workspace` and `--board`. Colour follows `NO_COLOR` and `FORCE_COLOR`. A command asks for a missing value (or a confirmation) only when stdin and stdout are terminals and neither `--json` nor `--no-prompt` is given; otherwise it exits 2, and destructive commands need `--yes`.

Long text such as a description takes `--description <text>`, `--description-file <path>` (`-` reads stdin) or `--edit`, which opens `$VISUAL` or `$EDITOR` (fallback `vi`). Comments take `--body`, `--body-file` and `--edit` in the same way. Repeatable flags such as `--assignee`, `--label` and `--field key=value` may also be comma-separated.

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
  from the roster, or `c` to clear the current Workspace and Board.
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
rowbly epics list [--closed|--all]                 # open Epics by default: ID, NAME, PROGRESS, BOARDS, CLOSED
rowbly epics create <id> --name <name> [--description <text> | --description-file <path|-> | --edit]
rowbly epics show <id>                             # details, progress, and Stories grouped by Board
rowbly epics edit <id> [--name <name>] [--description <text> | --description-file <path|-> | --edit]
rowbly epics close <id>                            # allowed even with open Stories
rowbly epics reopen <id>
rowbly epics delete <id> [--yes]                   # unlinks its Stories (epicId: null) and warns with the count
```

Every verb takes `--workspace <id>` (default: `ROWBLY_WORKSPACE`, then the current context). In the TUI, open **Epics** from the `g` palette: `enter` opens an Epic, `n` creates one, `a` cycles through open, all and closed Epics. On an Epic, `enter` opens a Story, `e` edits, `c` closes or reopens, and `d` deletes.
<!-- END epics -->

<!-- BEGIN doctor -->
### Doctor

`doctor` validates the whole Data Root. Run it after merging a branch that changed `.rowbly/`.

```text
rowbly doctor           # report findings grouped by severity; exit 0 with no errors, 6 when errors remain
rowbly doctor --fix     # repair what is safe to repair, then report what remains
rowbly doctor --json    # a DoctorReport: { findings, fixed, summary }
```

| Code | Severity | Detects | `--fix` |
| --- | --- | --- | --- |
| `SCHEMA_INVALID` | error | A file that is not valid JSON, fails its schema, or a required config file that is missing | — |
| `ID_PATH_MISMATCH` | error | An id or key inside a file that does not match its path | — |
| `STORY_KEY_CONFLICT` | error | A Story file with git conflict markers from two branches that each created the same key | Keeps the earlier Story under the key and gives the later one the next free key |
| `DUPLICATE_KEY` | error | Two Story files with the same `key` | Renumbers the Story created later |
| `CONFLICT_MARKERS` | error | Conflict markers in any other file, including one Story edited on both branches | — (merge by hand) |
| `DUPLICATE_PREFIX` | error | Two Boards with the same key prefix | — |
| `UNKNOWN_STAGE` | error | A Story or Task in a Stage that is not in its Board's effective Stages | — (use `stories move` / `tasks move`) |
| `UNKNOWN_ASSIGNEE` | warning | A Story Assignee that is not in the Workspace roster | Removes it |
| `MISSING_EPIC` | warning | An `epicId` with no Epic file | Sets it to `null` |
| `UNKNOWN_FIELD` / `INVALID_FIELD_VALUE` | warning | A Custom Field value with no definition, or one that does not fit its definition | Strips unknown fields; invalid values are only reported |
| `MISSING_REQUIRED_FIELD` | warning | A required Custom Field without a value | — |
| `TASK_COUNTER_BEHIND` | warning | `nextTaskNumber` at or below the highest Task number | Sets it to the highest + 1 |
| `DUPLICATE_RANK` | warning | Stories in one Stage with the same Rank | Re-ranks the tied Stories, keeping the current order |
| `STALE_LOCAL_STATE` | warning | `local.json` names a Workspace, Board or Me that does not exist | Clears those entries |
| `UNKNOWN_FILE` | info | A file outside the Data Root layout | — |

Story Keys are allocated as the highest number on the Board + 1 without a shared counter, so two branches can create the same key. After the merge, `rowbly doctor --fix` keeps the earlier Story and renumbers the other one (for example `WEB-4` and `WEB-5`), renaming its Task ids to match. Then `git add .rowbly` and commit the merge as usual. Renumbering changes a Story Key, so update any branch names or commit messages that used it.

In the TUI, open **Doctor** from the `g` palette: `f` fixes and `r` checks again.
<!-- END doctor -->

<!-- BEGIN tui -->
## Interactive mode (TUI)

Run `rowbly` with no command in a terminal to open the full-screen app; global flags such as `--root` still apply. Without a terminal `rowbly` prints help and exits 2. With no Data Root, a first-run screen offers to create one here or globally. With a Board in context (`rowbly use <workspace>/<board>`, or the only Board in the only Workspace) the app opens on that Board's Kanban board; otherwise it opens the home menu.

The board shows the Board's Stages side by side, in Stage order. Each Stage header shows its name coloured by Stage Category and its number of Stories; Stories are in Rank order and show the Story Key, Priority, name, Assignees and how many Tasks are done (`✓ 1/3`). When the Stages do not fit the terminal width the board scrolls sideways (`‹2` / `3›` count the hidden Stages), and a long Stage scrolls up and down. Moves show at once; if a change cannot be saved, the Story goes back where it was and an error is shown. The board reloads from disk when you come back to it from another screen.

### Keys on every screen

| Key | Action |
| --- | --- |
| `↑`/`↓`, `j`/`k` | move |
| `enter` | select or open |
| `/` | filter a list by typing (on the board and the Stories list: open the filter form) |
| `esc` | back (or cancel the open form) |
| `g` | go to any screen: Board, Stories, Epics, Workspaces, Boards, Assignees, Stages, Fields, Context, Doctor |
| `?` | the keys of the current screen |
| `q` | quit (from the first screen) |

In a form, `↑`/`↓` move between fields, `space` toggles a yes/no field or a multi-choice option, `←`/`→` change a choice, `e` opens `$EDITOR` for a description, and `enter` or `ctrl+s` saves.

### Keys per screen

| Screen | Keys |
| --- | --- |
| Board | `h`/`l` previous / next Stage, `j`/`k` next / previous Story, `enter` open, `H`/`L` move the Story to the previous / next Stage (bottom), `K`/`J` move it up / down in its Stage, `T`/`B` move it to the top / bottom of its Stage, `n` new Story in this Stage, `e` edit, `d` delete, `/` filter by Assignee, Me, Label, Priority, Epic or text, `c` clear the filter, `b` switch Board, `r` reload |
| Stories | `enter` open, `n` new, `/` filter by Stages, Assignees, Me, Labels, Priorities, Epic, text, Stage Category or open only, and sort, `c` clear the filter |
| Story | `tab`/`←`/`→` switch between Details, Tasks and Comments, `e` edit, `m` move to a Stage, `d` delete |
| Story › Tasks | `enter` open, `n` new, `e` edit, `m` move to a Stage, `d` delete |
| Story or Task › Comments | `c` add, `e` edit, `d` delete (bodies open in `$EDITOR`) |
| Epics | `enter` open, `n` new, `a` show open → all → closed Epics |
| Epic | `enter` open a Story, `e` edit, `c` close or reopen, `d` delete |
| Workspaces | `enter` use and open (then: Assignees, Edit, Delete), `n` new |
| Assignees | `enter` open (then: Edit, Remove), `n` add |
| Boards | `enter`/`s` Stages, `f` Custom Fields, `n` new, `e` edit, `d` delete |
| Stages | `n` add, `e` edit, `K`/`J` move up / down, `T`/`B` move first / last, `d` remove (asks where to move Stories still in it), `l` switch level |
| Fields | `n` add, `e` edit, `d` remove, `l` switch level |
| Context | `enter` switch Workspace, then Board, `m` pick Me from the roster, `c` clear the current Workspace and Board |
| Doctor | `f` fix, `r` check again |
<!-- END tui -->

## Exit codes

| Code | Meaning | `--json` error code |
| --- | --- | --- |
| 0 | Success | — |
| 1 | Internal error (a bug, or an unexpected failure such as an unreadable file) | `INTERNAL` |
| 2 | Usage error: bad flags, a missing argument, context that cannot be resolved, or a destructive command without `--yes` when not interactive | `USAGE` |
| 2 | Validation error: input that breaks a schema or reference rule; `details.issues` lists them | `VALIDATION` |
| 3 | Not found: an unknown Workspace, Board, Story, Task, Comment, Epic, Stage, Custom Field or Assignee | `NOT_FOUND` |
| 4 | Conflict: an id or key prefix that exists, or a refused deletion | `CONFLICT` |
| 5 | No Data Root found (run `rowbly init`) | `NO_DATA_ROOT` |
| 6 | Data integrity: a file that is not valid JSON, fails its schema, or whose id does not match its path; `details.path` names it | `DATA_INTEGRITY` |

`rowbly doctor` also exits 6 while errors remain.

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

The build specification lives in [`docs/spec/`](docs/spec/README.md) and the decisions in [`docs/adr/`](docs/adr/). Use the terms in [`CONTEXT.md`](CONTEXT.md).

- `test/helpers` provides `tempRoot()` (a throwaway `.rowbly/`), `fixedClock()`, `fixedIds()`, fixture builders (`makeWorkspace`, `makeBoard`, `makeStory`, `makeEpic`) and `runCli(args, { root, env, stdin, cwd })`, which runs the built `dist/cli.js` in a child process. `pnpm test` builds `dist/cli.js` first (vitest global setup), so `runCli` always tests the current source.
- `test/tui/helpers.tsx` provides `renderTui()` with a `press(...keys)` helper and `waitForFrame(app, text | RegExp | predicate)`, which polls the screen. Wait for what a screen shows rather than sleeping a fixed time.
- `test/e2e` runs the whole product through the built CLI, checks every exit code, and fails if a word that `CONTEXT.md` says to avoid reaches a help page or a message.
