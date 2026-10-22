# Rowbly user guide

Every command, flag, key, doctor finding and exit code. To install Rowbly and create a first Board, start with the [README](../README.md). How Rowbly is built is in the [documentation index](README.md).

Rowbly keeps Boards and Stories as pretty-printed JSON files in a `.rowbly/` folder, so a small team can keep its tracker inside a code repository and share it through git, with no server and no database. Use it in two ways, with the same features in both:

- `rowbly` with no command opens a full-screen interactive app (the TUI) with a Kanban board, detail views and forms.
- `rowbly <noun> <verb> …` runs one command and exits, for scripts and quick edits. Every list and show command has `--json` output.

## Install

Requires Node.js 22.12 or newer.

```sh
npm install -g rowbly   # or: pnpm add -g rowbly
rowbly --version
```

To install from source (needs pnpm):

```sh
git clone https://github.com/sgolovine/rowbly.git
cd rowbly
pnpm install && pnpm build && pnpm add -g "$PWD"   # or: npm i -g .
```

`pnpm add -g` installs `rowbly` into pnpm's global bin directory. If that directory is not on your `PATH`, pnpm tells you to run `pnpm setup` once.

## Quick start

```sh
cd my-project
rowbly init --board web --board-name Website --prefix WEB
rowbly use web                       # init already did this; use it to switch later
rowbly stories create --name "Login page" --priority P1
rowbly                               # open the board in the TUI
```

`init` creates `.rowbly/` in the current directory with a Board `web` whose Stories are keyed `WEB-1`, `WEB-2`, …. In a terminal, `rowbly init` with no flags asks for the same values. Run `rowbly whoami <handle>` once (or use the **Me** section of the TUI's settings) to set Me, the creator of your Stories (and the author of your Comments, with the Comments Plugin on), in every Data Root.

## Concepts

The exact meaning of each term is in [`CONTEXT.md`](agents/CONTEXT.md). In short:

- A **Data Root** (`.rowbly/`) holds everything: its **Boards**, and the data of its Plugins.
- A **Board** holds **Stories**. Each Story has a **Story Key** made of the Board's key prefix and a number (`WEB-42`), sits in one **Stage**, and has a **Rank** inside that Stage. A Story never moves to another Board.
- A Story has a name, a markdown description, a **Priority** (`P0` most urgent to `P4`), **Labels**, a due date, **Custom Field** values, and, with the Tasks Plugin on, **Tasks** (`WEB-42.1`).
- Every Board starts with the **Backlog** Stage and ends with the **Done** Stage. Both are fixed: they cannot be edited, moved or removed. The Stages you configure sit between them.
- Each Stage belongs to a **Stage Category**: `backlog` (Backlog), `board` (every configured Stage) or `done` (Done).
- **Me** is the handle you claim with `rowbly whoami`. It is **global Me**, kept in `~/.rowblyrc.json` and used in every Data Root, unless a Data Root has a **local Me** (`rowbly whoami --local <handle>`), which replaces it there. The local Me and the current Board are **Local State**, kept in `.rowbly/local.json`, which is never committed.
- **Plugins** add optional features; a Data Root turns each one on or off for everyone who uses it. See [Plugins](#plugins).

## Data Root and git workflow

Each run opens the first of:

1. `--data-root <path>`, the `.rowbly` folder itself (`--data-root ~/notes/.rowbly`, not `~/notes`).
2. The known Data Root marked `"default": true` in the Home Config, `~/.rowblyrc.json` (see below).
3. `.rowbly/` in the current directory or the nearest parent, like git looks for `.git`.
4. `~/.rowbly` (create it with `rowbly init --global`).

With none of these a command exits 5 (`NO_DATA_ROOT`) and the TUI offers to create one. If the Data Root named by `--data-root` or by the default is missing, Rowbly exits 5 naming it rather than opening another one. If several known Data Roots are marked default, commands without `--data-root` exit 2 listing them; keep one, or pass `--data-root`. `rowbly doctor --data-root <path>` reports them as `MULTIPLE_DEFAULT_DATA_ROOTS` and never picks one for you. `ROWBLY_ROOT` and `--root` are no longer supported: a run with `ROWBLY_ROOT` set exits 2 asking you to unset it.

```text
.rowbly/
  rowbly.config.json                 # optional Stages / Custom Fields, Plugin entries
  local.json                         # Local State (git-ignored)
  .gitignore                         # keeps local.json out of git
  plugins/<id>/                      # files of a Plugin, for the whole Data Root
  boards/<board>/
    board.config.json                # name, key prefix, optional Stages / Custom Fields
    plugins/<id>/                    # files of a Plugin, for this Board
    stories/<KEY>/
      story.json                     # one Story, with its Plugin Data (e.g. its Tasks)
      plugins/<id>/                  # files of a Plugin, for this Story
```

Rowbly also keeps a per-user Home Config, `~/.rowblyrc.json`, outside every Data Root. Every run of `rowbly` creates it as `{ "version": 1 }` when it is missing and never replaces an existing one. Rowbly keeps keys it does not know when it changes the file, and changes a symlinked one at its target. If the file is not valid JSON, Rowbly leaves it alone and a command that needs it fails with exit code 6 naming the file; fix or move it.

Its `dataRoots` list holds the Data Roots you use, each `{ "label"?, "path", "default"? }`. Rowbly adds every Data Root it opens or creates (one with a `rowbly.config.json`), once per folder even when you reach it through a symlink or `~`, and never changes a label or the default when it does. Mark one entry `"default": true` to open it from any folder. When the home folder cannot be written, a command that would add a new Data Root warns and still runs.

Commit `.rowbly/` with your code; `init` writes a `.gitignore` that keeps `local.json` and Rowbly's lock and commit files (`.lock`, `.lock.break`, `.txn/`) out. Each Story is its own folder, so most changes touch one small file and merge cleanly.

- **Story Keys** are the highest number on the Board plus one. There is no shared counter, so two branches can both create `WEB-7`. After such a merge, run `rowbly doctor --fix`: it keeps the earlier Story as `WEB-7` and renumbers the other one (its Task Ids follow, as they start with the Story Key). Update branch names or commit messages that used the renumbered key.
- **Deleted keys may be reused.** If the highest-numbered Story is deleted, the next new Story gets its number. git history still shows which Story a key meant at any time.
- **Run `rowbly doctor` after every merge** that touched `.rowbly/`. It reports conflict markers, invalid files, references to Stages that no longer exist, and other drift, and `--fix` repairs what is safe to repair. See [Doctor](#doctor).

## Configuration Cascade

Stages and Custom Fields are configuration, not data. Each list can be defined at two levels:

1. `rowbly.config.json` (global),
2. `board.config.json` (Board).

A Board uses the most specific level that defines the list; the lists are not merged. With no list anywhere, a Board has the built-in Stages `todo` (Todo) and `in-progress` (In Progress) between Backlog and Done, and no Custom Fields. A `stages` list holds only the Stages between Backlog and Done, as `{ "key", "name" }`; it never names `backlog` or `done`.

`stages` and `fields` commands take `--level board|global` (default: `board` when a Board is in context, else `global`). Changing a level that has no list of its own first copies the list it inherits to that level, then applies the change. A change at `global` level applies to every Board that inherits from it. `rowbly config show` prints a Board's effective lists and the level each one comes from.

## Global flags

| Flag | Meaning |
| --- | --- |
| `--data-root <path>` | Use this Data Root folder (the `.rowbly` folder itself) instead of the default or a discovered one |
| `--json` | Machine-readable output on stdout; errors as `{"error":{"code","message","details"}}` on stderr |
| `--yes` | Skip confirmations |
| `--no-prompt` | Never prompt; fail when input is missing |
| `-h, --help` | Show help |
| `-V, --version` | Show the version |

`ROWBLY_BOARD` stands in for `--board`. Colour follows `NO_COLOR` and `FORCE_COLOR`. A command asks for a missing value (or a confirmation) only when stdin and stdout are terminals and neither `--json` nor `--no-prompt` is given; otherwise it exits 2, and destructive commands need `--yes`.

Long text such as a description takes `--description <text>`, `--description-file <path>` (`-` reads stdin) or `--edit`, which opens `$VISUAL` or `$EDITOR` (fallback `vi`). Repeatable flags such as `--label` and `--field key=value` may also be comma-separated.

## Command reference

<!-- BEGIN setup -->
### Setup: `init`, `use`, `whoami`, `config`

```sh
rowbly init [--global] [--label <label>] [--default] [--board <id> --board-name <name> --prefix <P>]
rowbly use [<board>] [--clear]
rowbly whoami [<handle>] [--clear] [--local]
rowbly config show [--board <id>]
```

- `init` creates `.rowbly/` in the current directory, `~/.rowbly` with `--global`, or the folder that
  `--data-root <path>` names (the Data Root folder itself). In an interactive terminal without
  `--global` or `--data-root` it asks which of the three: this directory, the home folder, or another
  folder whose path you type (`~/` is your home folder). It writes `rowbly.config.json` with the default
  Stages and a `.gitignore` that keeps `local.json` out of git. An existing Data Root exits 4. With the
  Board flags it also creates the Board and makes it the current context, so later commands need no
  flags. In an interactive terminal it asks for them instead (suggesting the Board id upper-cased as the
  prefix).
- `init` records the new Data Root in the `dataRoots` of `~/.rowblyrc.json`. `--label <label>` names it
  there. `--default` makes it the default Data Root, opened from every directory unless `--data-root`
  names another; any other Data Root marked default stops being the default in the same write. In an
  interactive terminal `init` asks for the label (leave it empty for none) and whether to make it the
  default. Without `--default` the defaults stay as they are, and `init` warns when another default
  Data Root is opened ahead of the new one. `init` checks the location, the Board and
  `~/.rowblyrc.json` before it writes anything. If it fails after the Data Root exists, the error names
  the Data Root and how to finish setting it up. With `--json` it prints `{ root, board, known }`,
  `known` being the Data Root's `dataRoots` entry.
- `use web` stores the current Board in `local.json`. Without a target it prints the current context
  and where it came from: a flag, the environment (`ROWBLY_BOARD`), `local.json`, or the only Board
  there is. A Board is resolved in that order: `--board`, `ROWBLY_BOARD`, `local.json`, the only Board.
- `whoami` prints Me and where it comes from: the local Me of the Data Root in context, else global
  Me, else nothing. `whoami <handle>` claims a handle (a lower-kebab-case slug) as global Me in
  `~/.rowblyrc.json`, and `--clear` unsets global Me; neither needs a Data Root. With `--local`
  they set or clear the local Me in this Data Root's `local.json` instead, which replaces global Me
  here; clear it to use global Me again. `--json` prints `{ "me", "source", "global", "local" }`:
  `me` is Me, `source` is `local`, `global` or `null`, and `local` is `null` outside a Data Root. A
  `~/.rowblyrc.json` that cannot be read fails every command that opens a Data Root (exit 6) rather
  than leave out global Me.
- `config show` prints the effective Stages and Custom Fields of a Board and the Configuration
  Cascade level each list comes from (`board`, `global` or `default`). `--json` prints
  an `EffectiveBoardConfig`.
- In the TUI, a first-run screen opens when no Data Root is found. It offers the same three locations
  as `init` (this directory, the home folder, or another folder whose path you type; `esc` goes back to
  the choice), then asks for the label, whether to make it the default Data Root, the first Board and
  your handle, which becomes global Me (`~/.rowblyrc.json`). Leave the label, the Board or the handle
  empty to skip it; an empty handle keeps the global Me you have. The **Me** section of the settings
  (`,`) shows Me and lists its two levels, **Global** (`~/.rowblyrc.json`) and **This Data Root**
  (`local.json`): `enter` edits the highlighted one; save a handle, or save it empty to clear that
  level. The Board sidebar switches the Board. The home menu's **Context** entry also switches it; press
  `c` there to clear the current Board. While `~/.rowbly` does not exist, Context also lists **Create global
  Data Root**, which runs the same form as the first-run screen (`init --global`) and then returns to the
  Data Root you are using.
- In the TUI, the button at the far left of the header names the Data Root that is open: its label in
  `~/.rowblyrc.json`, else **Global** for `~/.rowbly`, else the folder that holds it. Click it, or press
  `D`, to open the Data Root switcher. It lists the known Data Roots with their paths and marks the
  `current` one, the `default` one and any that are `missing`. `enter` (or a click) opens the
  highlighted one with its own Boards, Plugins and Me, on the home screen; the screens, filters and
  sidebar picks of the previous one close. Switching changes nothing in `~/.rowblyrc.json`: the labels
  and the default stay as they are, and the next run opens the default as before. A Data Root that
  cannot be opened (moved, removed or broken) shows an error and the app stays where it was. The last
  row, **+ New Data Root** (or `n`), runs the setup form and opens the new Data Root. While a form holds
  unsaved changes, both ask before discarding them; `D` is typed as text while a text field has focus.
- The **Config** section of the settings is the TUI's `config show`: the Board detail for the Board
  in context, with its effective Stages and Custom Fields and the level each list comes from.
<!-- END setup -->

<!-- BEGIN assignees -->
### Assignees

Assignees are a Built-in Plugin: run `rowbly plugins enable assignees` first. The Data Root has one
roster of Assignees, kept in `.rowbly/plugins/assignees/roster.json`.

```text
rowbly assignees list
rowbly assignees add <handle> --name <name> [--email <email>]
rowbly assignees edit <handle> [--name <name>] [--email <email>]   # --email "" removes the email
rowbly assignees remove <handle>
rowbly stories list … [--assignee <h|me>…]
rowbly stories create … [--assignee <h|me>…]
rowbly stories edit … [--assignee <h|me>… | --add-assignee <h|me>… | --remove-assignee <h|me>…]
```

- Handles are slugs, unique within the Data Root. An email is optional but must be valid.
- A Story has zero or more Assignees, kept as Plugin Data on the Story
  (`"plugins": { "assignees": { "assignees": ["sam"] } }`). Read them with `stories show`;
  Tasks link back to their Story.
- `--assignee` may be repeated or comma-separated, and `me` means Me (exit 2 when Me is not set).
  An Assignee must be in the roster: otherwise the command exits 2 and `--json` lists the valid
  handles in `details.validHandles`.
- `remove` also takes the handle off every Story in the Data Root and warns with the count, e.g.
  `warning: Assignee "sam" removed from 1 story`.
- `doctor` reports `ASSIGNEES_UNKNOWN_ASSIGNEE` for a Story Assignee that is not in the roster and
  `ASSIGNEES_UNKNOWN_ME` for a local Me that is not (global Me is not checked); `--fix` removes them. A roster file that cannot be
  read is `ASSIGNEES_ROSTER_UNAVAILABLE` (error, fixed by hand).
- In the TUI, an **Assignees** section in the settings (`,`) lists the roster (`enter` open, then
  Edit or Remove; `n` new Assignee). The Story form has an Assignees choice, the filter has Assignees
  and "Assigned to me", and Stories on the board, the board's list view and Story list rows show `@handle`.
- Rosters and Story Assignees from a Rowbly before this Plugin are not imported: core drops them the
  next time it saves `rowbly.config.json` or the Story.
<!-- END assignees -->

<!-- BEGIN boards -->
### Boards

```text
rowbly boards list
rowbly boards create <id> --name <n> --prefix <P> [--description <text>]
rowbly boards show [<id>]                             # effective Stages and Custom Fields, their source level, Stories per Stage
rowbly boards edit <id> [--name <n>] [--description <text>]
rowbly boards delete <id> [--force]                  # confirms; pass --yes when not interactive
```

- The key prefix (`WEB` in `WEB-42`) must be unique across the whole Data Root; a clash exits 4. Lower case is accepted and upper-cased.
- A new Board has no Stage or Custom Field lists of its own: it inherits them through the Configuration Cascade.
- `delete` refuses a Board that has Stories (exit 4) unless `--force`. Deleting the current Board clears it from Local State.
- In the TUI, **Boards** `enter` opens the Board detail (`boards show`): name, key prefix, description, Stories per Stage, and the effective Stages and Custom Fields with their source level. `v` opens a Board's board for viewing only, like `--board` on a read command: the current context and `local.json` do not change.
<!-- END boards -->

<!-- BEGIN stages -->
### Stages

```text
rowbly stages list
rowbly stages add <key> --name <n> [--before <key>|--after <key>]
rowbly stages edit <key> --name <n>
rowbly stages move <key> (--before <key>|--after <key>|--first|--last)
rowbly stages remove <key> [--move-to <key>]
# every verb also takes: [--board <id>] [--level board|global]
```

- `--level` picks the Configuration Cascade level to edit. The default is `board`, the Board in context, or `global` when no Board resolves.
- Editing a level that has no list of its own first copies the list it inherits, then applies the change. An edit at `global` level applies to every Board that inherits from it; the output lists those Boards.
- `remove` refuses (exit 4) while a Story on an affected Board is in the Stage, and the Tasks Plugin refuses while a Task is. `--move-to` moves them first (Backlog and Done are valid targets); moved Stories go to the bottom of the target Stage.
- `backlog` and `done` are fixed: `edit`, `move` and `remove` refuse them (exit 2), and `add` cannot use their keys. `add` puts a Stage just before Done by default; `--after backlog` puts it first. `move --first` and `--last` mean just after Backlog and just before Done.
- `--json` prints `{ level, items, affectedBoards }` (plus `storiesMoved` for `remove`). `items` is every Stage of the level, Backlog and Done included, each with its `category`.
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
# every verb also takes: [--board <id>] [--level board|global]
```

- Levels and copy-on-write work as for Stages. A field's key and type never change.
- `--options` applies to `select`/`multiselect` and may be repeated or comma-separated; `--min`, `--max` and `--integer` apply to `number`.
- `remove` strips the field's values from every Story on the affected Boards. An edit (for example dropping an option) strips the values that no longer fit. Both print a warning with the count.
- Values are given to Stories as `--field key=value`: `true`/`false`, numbers, `YYYY-MM-DD` dates, absolute http(s) URLs, and comma-separated multiselect values.
<!-- END fields -->

<!-- BEGIN stories -->
### Stories

```text
rowbly stories list [--stage <k>…] [--category backlog|board|done] [--open]
                    [--label <l>…] [--priority <P>…] [--search <text>]
                    [--sort rank|priority|created|updated|due] [--board <id>] [--all-boards]
rowbly stories create --name <n> [--description <text>|--description-file <path|->|--edit] [--stage <k>]
                      [--priority <P>] [--label <l>…] [--due <YYYY-MM-DD>]
                      [--field key=value …] [--board <id>]
rowbly stories show <KEY>
rowbly stories edit <KEY> [--name <n>] [description flags]
                    [--priority <P> | --no-priority]
                    [--label <l>… | --add-label <l>… | --remove-label <l>…]
                    [--due <date> | --no-due] [--field key=value …] [--unset-field <key>…]
rowbly stories move <KEY> <stage> [--top]
rowbly stories rank <KEY> (--before <KEY>|--after <KEY>|--top|--bottom)
rowbly stories delete <KEY>                          # confirms; pass --yes when not interactive
```

- A new Story gets the next Story Key on its Board: the highest existing number plus one. If the highest-numbered Story is deleted, its key is given to the next new Story.
- A new Story goes to the bottom of its Stage (default: the first effective Stage). `createdBy` is Me.
- Story Keys are case-insensitive (`web-2` is `WEB-2`) and need no `--board`: the key prefix finds the Board.
- Repeatable flags (`--label`, `--stage`, `--priority`, `--field`) may also be comma-separated.
- Custom Field values must fit their field; required fields must have a value. A violation exits 2 and `--json` lists the problems in `details`.
- Plugins that are on add their own options, such as `--assignee` ([Assignees](#assignees)) or `--epic`.
- `list` lists the current Board; `--all-boards` lists every Board in the Data Root. It sorts by Stage order then Rank. `--sort priority` puts the most urgent first, `created` the oldest first, `updated` the newest first and `due` the soonest first. `--open` hides Stories in a `done` Stage. `--search` matches name and description, ignoring case.
- `move` places the Story at the bottom of the target Stage, or at the top with `--top`. `rank` reorders a Story within its Stage. Both write only that Story's file.
- `--json` prints Story objects: an array for `list`, one Story for `create`, `show`, `edit`, `move` and `rank`, and `{ deleted }` for `delete`.
- In the TUI, the **Stories** list's `A` shows every Board in the Data Root (`--all-boards`), with the Board on each row. The `/` filter on the Stories list and on the board takes several values per field, like a repeated flag.
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

Tasks are a Built-in Plugin: run `rowbly plugins enable tasks` first.

- Tasks are Plugin Data on their Story (`"plugins": { "tasks": { "nextNumber": …, "tasks": [ … ] } }`). A Task Id is the Story Key plus a number (`WEB-42.1`), taken from the bag's `nextNumber`. Numbers are never reused: after deleting `WEB-42.3`, the next Task is still `WEB-42.4`.
- A new Task goes into the first effective Stage unless `--stage` is given. The Stage must be one of the Board's effective Stages; `move` to any other Stage exits 2.
- Tasks are listed in creation order and have no Rank.
- Every change updates both the Task's and the Story's `updatedAt`.
- `--json` prints Task objects (the stored fields and `id`): an array for `list`, one Task for `create`, `show`, `edit` and `move`, and `{ deleted }` for `delete`.
- `stories show` has a Tasks row (`2/5 done`), and the Story on the board and the board's list view show `✓ 2/5`.
- In the TUI, a Story's **Tasks** tab and the Task screen both edit (`e`), move (`m`) and delete (`d`) a Task.
<!-- END tasks -->

<!-- BEGIN comments -->
### Comments

Comments are a Built-in Plugin: run `rowbly plugins enable comments` first.

```text
rowbly comments list <KEY>
rowbly comments add <KEY> [--body <text>|--body-file <path|->|--edit]
rowbly comments edit <KEY> <comment-id> [--body <text>|--body-file <path|->|--edit]
rowbly comments delete <KEY> <comment-id>   # confirms; pass --yes when not interactive
```

- The target is a Story Key (`WEB-42`). Tasks have no Comments.
- The author is Me, or none when Me is not set. Comment ids are 8-character random ids.
- The body comes from exactly one of `--body`, `--body-file` (`-` reads stdin) or `--edit` (`$VISUAL`/`$EDITOR`, fallback `vi`). Without any of them, an interactive run asks for the body; otherwise the command exits 2. An empty body exits 2.
- `list` shows Comments oldest first. `edit` updates the Comment's `updatedAt`.
- `--json` prints Comment objects: an array for `list`, one Comment for `add` and `edit`, and `{ deleted }` for `delete`.
- Comments are stored as Plugin Data on their Story (`"plugins": { "comments": { "comments": [ … ] } }`). `stories show` counts them.
- In the TUI, the Story screen gets a **Comments** tab: `n` new Comment, `e` edit (both open the Comment form), `d` delete.
<!-- END comments -->

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
| `UNKNOWN_STAGE` | error | A Story in a Stage that is not in its Board's effective Stages | — (use `stories move`) |
| `UNKNOWN_FIELD` / `INVALID_FIELD_VALUE` | warning | A Custom Field value with no definition, or one that does not fit its definition | Strips unknown fields; invalid values are only reported |
| `MISSING_REQUIRED_FIELD` | warning | A required Custom Field without a value | — |
| `DUPLICATE_RANK` | warning | Stories in one Stage with the same Rank | Re-ranks the tied Stories, keeping the current order |
| `STALE_LOCAL_STATE` | warning | `local.json` names a Board that does not exist | Clears it |
| `UNKNOWN_FILE` | info | A file outside the Data Root layout | — |
| `PLUGIN_FAILED` | error | A Plugin that is on failed to load | — (see `rowbly plugins list`) |
| `PLUGIN_DATA_INVALID` | warning | Plugin Data of a Plugin that is on that does not match its schema | — |
| `PLUGIN_DATA_UNCHECKED` | info | Data of a Plugin that is off or that this version does not have, reported once per Plugin | — |
| `TRANSACTION_PENDING` | error | A commit that was interrupted and could not be completed | Tries the recovery again |
| `TRANSACTION_LEFTOVER` | warning | The folder of a finished or abandoned commit in `.txn/` that could not be removed | Removes it |
| `TEMP_FILE_LEFTOVER` | warning | A temporary file of an interrupted write (the file beside it is intact), or a `.moving` folder from an older Rowbly | Removes a temporary file; a `.moving` folder is only reported (move its Story back by hand) |
| `ORPHAN_FOLDER` | warning | A Board or Story folder with Plugin files but no `board.config.json` / `story.json`; a Story folder still reserves its key | — (restore the file or delete the folder) |
| `LEGACY_DATA` | warning | Comments, an `epicId`, Story Assignees, Epic files or an Assignee roster from a Rowbly before Plugins; nothing imports them, and the next save of that Story or `rowbly.config.json` drops them | — (back up first) |
| `MULTIPLE_DEFAULT_DATA_ROOTS` | error | More than one `dataRoots` entry in `~/.rowblyrc.json` marked `"default": true`, even two naming one folder; its path is the Home Config and `details.defaults` lists the entries. Without `--data-root` every command refuses to start, so run `rowbly doctor --data-root <path>` | — (keep one default by hand) |
| `GITIGNORE_INCOMPLETE` | info | A Data Root `.gitignore` that does not list `local.json`, `.lock`, `.lock.break` and `.txn/` | Adds the missing lines |
| `<PLUGIN>_…` | any | The checks of a Plugin that is on, such as `EPICS_MISSING_EPIC` or `TASKS_COUNTER_BEHIND` | As the Plugin says |

Story Keys are allocated as the highest number on the Board + 1 without a shared counter, so two branches can create the same key. After the merge, `rowbly doctor --fix` keeps the earlier Story and renumbers the other one (for example `WEB-4` and `WEB-5`), moving its folder with its Plugin files; its Task Ids follow the new key. Then `git add .rowbly` and commit the merge as usual. Renumbering changes a Story Key, so update any branch names or commit messages that used it.

In the TUI, open **Doctor** from the settings (`,`): `f` fixes and `r` checks again.
<!-- END doctor -->

<!-- BEGIN plugins -->
### Plugins

Plugins add optional features to Rowbly. Every Plugin ships with Rowbly (a Built-in Plugin) and is off until the Data Root turns it on, for everyone who uses it. The design is in [the plugin system](plugins/README.md) and the [Built-in Plugins](plugins/built-in.md) page; to write one, follow [Writing a Plugin](plugins/writing-a-plugin.md) and the [Plugin API reference](plugins/api.md).

```text
rowbly plugins list            # every Built-in Plugin, whether it is on, and any that failed to load
rowbly plugins show <id>       # a Plugin and its stored settings
rowbly plugins enable <id>
rowbly plugins disable <id>    # keeps its settings and data
```

- A Plugin is on when its entry in `rowbly.config.json` has `"enabled": true`; its settings sit beside it, and a Board can change them in its own `board.config.json` (`"plugins": { "<id>": { … } }`). Edit settings by hand and keep `enabled`; a Plugin that needs a setting refuses `plugins enable` until it is there ([Settings](plugins/README.md#settings)). `rowbly init` turns no Plugins on. Command mode reads the configuration on every run; the TUI when it starts and when you turn a Plugin on or off.
- A Plugin that is on adds commands under `rowbly <id>`, options on core commands (in their `--help`), rows to `stories show`, and checks to `doctor`. It keeps its values on records as `"plugins": { "<id>": { … } }` and its files in `plugins/<id>/` folders. Rowbly keeps both unchanged while the Plugin is off, and `--json` prints records with them.
- A Plugin that fails to load (its settings are invalid, it throws while it starts, it clashes with a name already in use, or this version of Rowbly does not have it) is skipped with a warning, and `plugins list` and `doctor` report it. Its data is kept.
- A Plugin can refuse a change (exit 4). An expected error from a Plugin keeps its own code, such as `VALIDATION` (exit 2) for bad input. If a Plugin fails unexpectedly while handling a change, nothing is saved and the command exits 1; the error names the Plugin and says how to turn it off. With `--json`, these errors carry `details.plugin` and `details.stage`.
- `ROWBLY_DEBUG=trace` prints each operation and Plugin step, with its time and outcome, to stderr.
- In the TUI, the **Plugins** section of the settings (`,`) turns Plugins on and off (`enter`).
<!-- END plugins -->

<!-- BEGIN tui -->
### Automatic Git commits

Enable the **Git** Plugin with `rowbly plugins enable git` while the Data Root is inside a Git repository. Otherwise activation reports an error. Git creates `chore: update Rowbly data` commits for saved Rowbly changes, including other Plugins' writes and deletions. Establish a clean Data Root baseline first: edits made by hand to the same affected paths are included. Other files and unrelated staged changes stay untouched; staged changes on an affected path cause a warning instead of a commit. Local State, locks and transaction files are excluded.

```sh
rowbly git show
rowbly git configure --frequency change
rowbly git configure --frequency interval --interval 600
rowbly git configure --author-name "Rowbly Bot" --author-email "bot@example.com"
rowbly git configure --author-name '' --author-email ''  # restore Git defaults
```

When Git is enabled and loaded, settings (`,`) includes **Git**, with frequency, interval in seconds (1–86400, default 300), and author name/email. These are personal preferences in Local State. The default frequency is after each change. Blank author fields use Git's effective `user.name` and `user.email` from repository/global configuration (`.gitconfig`).

Saved changes enter a Git queue. The TUI stays usable while commits run; rapid edits may share a commit. Git commits a snapshot of saved files and keeps later edits queued. Command mode waits for due commits, without the reaction's five-second deadline; it does not wait for future interval deadlines.

Interval mode batches changes from the first pending write without postponing the deadline. It commits only when files changed. Timers run while Rowbly is open; CLI commands exit without waiting for a future deadline. Pending paths persist in Git's directory and resume on the next Rowbly run. No daemon runs after exit. Disabling Git pauses waiting work until re-enabled; an already running commit may finish.

Git failures warn without undoing a saved Rowbly change; pending work is retried on a later run. Git hooks and commit signing are disabled for these commits. Git never pushes automatically. See [Git Plugin details](plugins/built-in.md#git).


## Interactive mode (TUI)

Run `rowbly` with no command in a terminal to open the full-screen app; global flags such as `--data-root` still apply. Without a terminal `rowbly` prints help and exits 2. With no Data Root, a first-run screen offers to create one here or globally. With a Board in context (`rowbly use <board>`, or the only Board in the Data Root) the app opens on that Board's Kanban board; otherwise it opens the home menu.

The board shows the Board's Stages side by side, in Stage order. Each Stage header shows its name coloured by Stage Category and its number of Stories; Stories are in Rank order and show the Story Key, Priority, name and what Plugins add, such as Assignees and how many Tasks are done (`✓ 1/3`). When the Stages do not fit the terminal width the board scrolls sideways (`‹2` / `3›` count the hidden Stages), and a long Stage scrolls up and down. With the mouse, a click selects a Story, a click on the selected Story opens it, and dragging a Story moves it to the place you drop it: onto another Stage, or up or down its own. While you drag, a blue block the size of a Story marks where it will land, under the pointer; the Stories around it move up or down to make room, and the Story lands there when you let go. Moves show at once; if a change cannot be saved, the Story goes back where it was and an error is shown. The board reloads from disk when you come back to it from another screen.

The header's **Stages / List** switch (or `v` on the board) changes how the board shows its Stories. **Stages** is the view above, and every launch starts with it. **List** shows one line per Story, with its Story Key, name and Stage, grouped under each Stage's name in Stage order. Stories in a section stay in Rank order. A section folds and unfolds, and a long list scrolls up and down. The choice lasts until you quit and applies to every Board; the highlighted Story stays highlighted when you switch.

A Plugin can add a **Plugin Sidebar** beside the Board sidebar, with a header button that shows and hides it, such as the Epics Plugin's **Epics**. Its first entry, such as **All Epics**, shows every Story; picking another entry shows only the Stories it stands for on the board, in both views, and the header says `filter: Epics: <name>`. The pick applies to every Board, stays while the sidebar is hidden, and lasts until you quit. The button at the bottom, such as **+ New Epic**, creates an entry.

A click in the Board sidebar or a Plugin Sidebar focuses it, and its border lights up like the board's. While a sidebar has focus, `↑`/`↓` (or `j`/`k`) pick the previous / next entry, `n` creates one (a new Board, or what its button creates, such as a new Epic) and `esc` or a click in the main area gives focus back to the board, where `n` makes a new Story. Drag a sidebar's right edge with the mouse to make it wider or narrower; the board keeps at least 24 columns, and the widths last until you quit.

The header does not show the Board name (the Boards sidebar marks the open Board); it shows the Board's state, such as its filter, after the Data Root button. It keeps its controls on one line; quiet controls disappear on narrow terminals while their keys stay available in Help. Each Story on the board has three rows in a rounded frame. The list view groups single-line Stories by Stage name, with foldable headings and `No Stories` for empty Stages. The footer shows screen keys on the left and global keys on the right; framed messages appear at bottom-right.

Story and Settings open in fixed-size screen modals over the Board, up to 120 columns wide. Their headers stay in place while `page up`/`page down` scroll the body. Forms, pickers, Help and Plugin screens open in smaller task modals; opening a task from Story or Settings keeps that screen underneath and returns to its selection when the task closes. Opening Settings from a Story replaces the Story. In Settings, `esc` returns from the section to its sidebar, then closes Settings.

The palette follows `COLORFGBG`: ANSI backgrounds 7 and 15 select the light theme, with dark as the fallback. Rowbly leaves the terminal background visible. Dates in the TUI use local time (for example, `20 Oct 2026, 23:03`); command JSON keeps ISO timestamps.

### Keys on every screen

| Key | Action |
| --- | --- |
| `↑`/`↓` (or `j`/`k`) | move |
| `enter` | select or open; a click on an item in a list does the same |
| `/` | filter a list by typing (on the board and the Stories list: open the filter form); while typing in a Specs list, letter keys enter filter text |
| `esc` | back (or cancel the open form) |
| `D` | switch Data Root (or click the Data Root's name at the left of the header): open another known Data Root, or create one |
| `,` | settings (or click **Settings** in the header), in a sidebar grouped into Global (Boards, global Stages and Fields, Me, Doctor, Plugins), the Board in context (Config, Stages, Fields), and a group for each Plugin with settings. `↑`/`↓` pick a section, `tab` (or `enter`) moves between the sidebar and the section |
| `ctrl+b` | hide or show the Board sidebar; it shows again at every launch |
| `\` | show the next Plugin Sidebar, or none (or click its button in the header) |
| `{`/`}` | pick the previous / next entry of the Plugin Sidebar on screen |
| `?` | the keys of the current screen |
| `q` | quit (from the first screen) |

In a form, `enter`, `tab` and `↓` move to the next field and `shift+tab` and `↑` to the previous one; the focused field scrolls into view, and after the last field `enter` saves. Saving is shown in the modal's key strip, with no separate Save button. `ctrl+enter` saves from any field; terminals without the kitty keyboard protocol send it as a plain `enter`, so `ctrl+s` saves there too. Text fields edit at the caret (`←`/`→`, `home`/`end`). Descriptions are written in place in a multi-line text box: `enter` starts a new line, and `↑`/`↓` leave the box from its first and last lines. `ctrl+f`, or a click on the **[Full screen]** button below the box, opens the text in the full-screen editor, titled with the field's name; `esc`, `ctrl+f` or a click on the `✕` in its border closes it and keeps what you wrote. `space` toggles a yes/no field or a multi-choice option, and `←`/`→` change a choice.

The full-screen editor fills the terminal and has two modes. **View** shows the markdown rendered, with headings, emphasis, lists, code and tables; `↑`/`↓` (or `j`/`k`) and `page up`/`page down` scroll it. **Edit** shows the raw text in a multi-line text box. `tab`, or a click on **View** or **Edit**, switches mode, and `e` also edits from view. A field's text opens in edit mode. A document that the editor saves itself, such as a Spec, opens in view mode: `ctrl+s` saves it, the bar above the text says whether it is saved, and closing with unsaved changes asks before discarding them.

### Keys per screen

The arrow keys are the main keys; the vim keys work too. `h`/`j`/`k`/`l` stand in for `←`/`↓`/`↑`/`→`, and `H`/`J`/`K`/`L` for `shift` with those arrows (on the board and the Stages screen). Wherever a screen or tab can create a record, `n` creates a new one.

| Screen | Keys |
| --- | --- |
| Board | `←`/`→` previous / next Stage, `↑`/`↓` previous / next Story, `enter` open, `shift+←`/`shift+→` move the Story to the previous / next Stage (bottom), `shift+↑`/`shift+↓` move it up / down in its Stage, `T`/`B` move it to the top / bottom of its Stage, `n` new Story in this Stage, `e` edit, `d` delete, `/` filter by Labels, Priorities, text and the filters Plugins add (several values per field), `c` clear the filter, `v` list view, `r` reload |
| Board (list view) | `↑`/`↓` previous / next line, `enter` open the Story or fold / unfold the section, `space` fold / unfold, `←`/`→` fold / unfold, `shift+↑`/`shift+↓` move the Story up / down in its Stage, and past the top / bottom to the bottom of the previous Stage / the top of the next, `n` new Story in the highlighted Story's Stage (on a section heading: that Stage), `e` edit, `d` delete, `/` filter, `c` clear the filter, `v` Stages view, `r` reload |
| Stories | `enter` open, `n` new Story, `/` filter by Stages, Labels, Priorities, text, Stage Category, open only and the filters Plugins add, and sort, `c` clear the filter, `A` all Boards / this Board only |
| Story | `tab`/`←`/`→` switch between Details and the tabs Plugins add, `e` edit, `m` move to a Stage, `d` delete |
| Story › Tasks (Tasks Plugin) | `enter` open, `n` new Task, `e` edit, `m` move to a Stage, `d` delete |
| Task (Tasks Plugin) | `e` edit, `m` move to a Stage, `d` delete |
| Story › Comments (Comments Plugin) | `n` new Comment, `e` edit, `d` delete |
| Assignees (Plugin) | `enter` open (then: Edit, Remove), `n` new Assignee |
| Boards | `enter` open the Board detail, `v` view its board without changing the context, `s` Stages, `f` Custom Fields, `n` new Board, `e` edit, `d` delete |
| Board detail (and Config) | `v` view its board, `o` its Stories list (both without changing the context), `s` Stages, `f` Custom Fields |
| Stages | `n` new Stage, `e` edit, `shift+↑`/`shift+↓` move up / down, `T`/`B` move first / last (just after Backlog / before Done), `d` remove (asks where to move Stories still in it), `l` switch level. Backlog and Done are marked fixed and ignore `e`, `d` and moves |
| Fields | `n` new Custom Field, `e` edit, `d` remove, `l` switch level |
| Me | `enter` edit the highlighted level (Global or This Data Root); in the form, `ctrl+s` saves the handle (empty clears that level) |
| Context | `enter` switch Board (or create the global Data Root while it does not exist), `c` clear the current Board |
| Doctor | `f` fix, `r` check again |
| Plugins | `enter` turn the Plugin on or off |

Long Story names and Plugin badges truncate to keep each Story on one line in the list view. Selection uses the same bar and fill in lists, forms and Plugin tabs.

Plugins that are on can add home menu entries, screens, fields to the Story form and filter, tabs and rows to the Story screen, badges to Stories on the board and in the board's list view, and sections to the Board detail. A Plugin's **Actions** are keys that show in the footer, the help (`?`) and as buttons in the header wherever the Board or Story they act on is in focus.
<!-- END tui -->

## Exit codes

| Code | Meaning | `--json` error code |
| --- | --- | --- |
| 0 | Success | — |
| 1 | Internal error (a bug, an unexpected failure such as an unreadable file, or a Plugin that failed while handling a change) | `INTERNAL` |
| 2 | Usage error: bad flags, a missing argument, context that cannot be resolved, or a destructive command without `--yes` when not interactive | `USAGE` |
| 2 | Validation error: input that breaks a schema or reference rule; `details.issues` lists them | `VALIDATION` |
| 3 | Not found: an unknown Board, Story, Task, Comment, Stage, Custom Field or Assignee | `NOT_FOUND` |
| 4 | Conflict: an id or key prefix that exists, a refused deletion, or a change a Plugin refused | `CONFLICT` |
| 5 | No Data Root found (run `rowbly init`), or the Data Root named by `--data-root` or the default is missing | `NO_DATA_ROOT` |
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
| `pnpm test` | Run every vitest project; the `cli` project builds the CLI into its own `.test-dist/run-*` folder first |
| `pnpm test:unit` | Run the suites that need no CLI build (storage, Plugins, TUI, rule checks) |
| `pnpm test:cli` | Run the suites that spawn a built CLI; builds the CLI into `.test-dist/run-*` first |
| `pnpm test:watch` | vitest in watch mode |
| `pnpm bench:plugins` | Opt-in Plugin benchmark (see [`test/performance/README.md`](../test/performance/README.md)) |

How Rowbly is built is in [`docs/`](README.md): the [architecture](architecture/overview.md), the [plugin system](plugins/README.md), the [development guide](development/README.md) and the [decisions](agents/adr/README.md). Use the terms in [`CONTEXT.md`](agents/CONTEXT.md).

The test projects, helpers and rules are in the [development guide](development/README.md#tests).
