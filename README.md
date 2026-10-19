# Rowbly

A developer-focused, file-backed Kanban tracker for the terminal.

Rowbly keeps Boards and Stories as pretty-printed JSON files in a `.rowbly/` folder, so a small team can keep its tracker inside a code repository and share it through git, with no server and no database. Use it in two ways, with the same features in both:

- `rowbly` with no command opens a full-screen interactive app (the TUI) with a Kanban board, detail views and forms.
- `rowbly <noun> <verb> …` runs one command and exits, for scripts and quick edits. Every list and show command has `--json` output.

## Install

Requires the Node.js version in [`.nvmrc`](.nvmrc).

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

`init` creates `.rowbly/` in the current directory with a Board `web` whose Stories are keyed `WEB-1`, `WEB-2`, …. In a terminal, `rowbly init` with no flags asks for the same values. Run `rowbly whoami <handle>` to set Me, the creator of your Stories (and the author of your Comments, with the Comments Plugin on).

## Concepts

The exact meaning of each term is in [`CONTEXT.md`](docs/agents/CONTEXT.md). In short:

- A **Data Root** (`.rowbly/`) holds everything: its **Boards**, and the data of its Plugins.
- A **Board** holds **Stories**. Each Story has a **Story Key** made of the Board's key prefix and a number (`WEB-42`), sits in one **Stage**, and has a **Rank** inside that Stage. A Story never moves to another Board.
- A Story has a name, a markdown description, a **Priority** (`P0` most urgent to `P4`), **Labels**, a due date, **Custom Field** values, and, with the Tasks Plugin on, **Tasks** (`WEB-42.1`).
- Each Stage belongs to a **Stage Category**: `todo`, `in_progress` or `done`.
- **Me** is the handle you claim with `rowbly whoami`. It and the current Board are **Local State**, kept in `.rowbly/local.json`, which is never committed.
- **Plugins** add optional features; a Data Root turns each one on or off for everyone who uses it. See [Plugins](#plugins).

## Data Root and git workflow

Rowbly looks for `.rowbly/` in the current directory and then in each parent, like git looks for `.git`. If it finds none it uses `~/.rowbly` (create it with `rowbly init --global`). `--root <path>` or `ROWBLY_ROOT` names a Data Root directly.

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

Commit `.rowbly/` with your code; `init` writes a `.gitignore` that keeps `local.json` and Rowbly's lock and commit files (`.lock`, `.lock.break`, `.txn/`) out. Each Story is its own folder, so most changes touch one small file and merge cleanly.

- **Story Keys** are the highest number on the Board plus one. There is no shared counter, so two branches can both create `WEB-7`. After such a merge, run `rowbly doctor --fix`: it keeps the earlier Story as `WEB-7` and renumbers the other one (its Task Ids follow, as they start with the Story Key). Update branch names or commit messages that used the renumbered key.
- **Deleted keys may be reused.** If the highest-numbered Story is deleted, the next new Story gets its number. git history still shows which Story a key meant at any time.
- **Run `rowbly doctor` after every merge** that touched `.rowbly/`. It reports conflict markers, invalid files, references to Stages that no longer exist, and other drift, and `--fix` repairs what is safe to repair. See [Doctor](#doctor).

## Configuration Cascade

Stages and Custom Fields are configuration, not data. Each list can be defined at two levels:

1. `rowbly.config.json` (global),
2. `board.config.json` (Board).

A Board uses the most specific level that defines the list; the lists are not merged. With no list anywhere, a Board has the built-in Stages `backlog` (Backlog, todo), `todo` (Todo, todo), `in-progress` (In Progress, in_progress) and `done` (Done, done), and no Custom Fields.

`stages` and `fields` commands take `--level board|global` (default: `board` when a Board is in context, else `global`). Changing a level that has no list of its own first copies the list it inherits to that level, then applies the change. A change at `global` level applies to every Board that inherits from it. `rowbly config show` prints a Board's effective lists and the level each one comes from.

## Global flags

| Flag | Meaning |
| --- | --- |
| `--root <path>` | Use this Data Root instead of discovering one (also `ROWBLY_ROOT`) |
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
rowbly init [--global] [--board <id> --board-name <name> --prefix <P>]
rowbly use [<board>] [--clear]
rowbly whoami [<handle>] [--clear]
rowbly config show [--board <id>]
```

- `init` creates `.rowbly/` in the current directory (`~/.rowbly` with `--global`, or the `--root` /
  `ROWBLY_ROOT` path). It writes `rowbly.config.json` with the default Stages and a `.gitignore` that
  keeps `local.json` out of git. An existing Data Root exits 4. With the Board flags it also creates
  the Board and makes it the current context, so later commands need no flags. In an
  interactive terminal it asks for them instead (suggesting the Board id upper-cased as the prefix).
- `use web` stores the current Board in `local.json`. Without a target it prints the current context
  and where it came from: a flag, the environment (`ROWBLY_BOARD`), `local.json`, or the only Board
  there is. A Board is resolved in that order: `--board`, `ROWBLY_BOARD`, `local.json`, the only Board.
- `whoami` prints Me. `whoami <handle>` claims a handle (a lower-kebab-case slug) and stores it in
  `local.json`; `--clear` unsets it.
- `config show` prints the effective Stages and Custom Fields of a Board and the Configuration
  Cascade level each list comes from (`board`, `global` or `default`). `--json` prints
  an `EffectiveBoardConfig`.
- In the TUI, a first-run screen offers to create the Data Root here or globally when none exists.
  The **Context** section of the settings (`,`) switches the Board; press `m` there to set Me, or `c` to
  clear the current Board. While `~/.rowbly` does not exist,
  Context also lists **Create global Data Root**, which runs the same form as the first-run screen
  (`init --global`) and then returns to the Data Root you are using.
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
  `ASSIGNEES_UNKNOWN_ME` for a Me that is not; `--fix` removes them. A roster file that cannot be
  read is `ASSIGNEES_ROSTER_UNAVAILABLE` (error, fixed by hand).
- In the TUI, an **Assignees** section in the settings (`,`) lists the roster (`enter` open, then
  Edit or Remove; `n` add). The Story form has an Assignees choice, the filter has Assignees and
  "Assigned to me", and board cards and Story list rows show `@handle`.
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
rowbly stages add <key> --name <n> --category todo|in_progress|done [--before <key>|--after <key>]
rowbly stages edit <key> [--name <n>] [--category <c>]
rowbly stages move <key> (--before <key>|--after <key>|--first|--last)
rowbly stages remove <key> [--move-to <key>]
# every verb also takes: [--board <id>] [--level board|global]
```

- `--level` picks the Configuration Cascade level to edit. The default is `board`, the Board in context, or `global` when no Board resolves.
- Editing a level that has no list of its own first copies the list it inherits, then applies the change. An edit at `global` level applies to every Board that inherits from it; the output lists those Boards.
- `remove` refuses (exit 4) while a Story on an affected Board is in the Stage, and the Tasks Plugin refuses while a Task is. `--move-to` moves them first; moved Stories go to the bottom of the target Stage. The last Stage cannot be removed.
- `--json` prints `{ level, items, affectedBoards }` (plus `storiesMoved` for `remove`).
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
rowbly stories list [--stage <k>…] [--category todo|in_progress|done] [--open]
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
- `stories show` has a Tasks row (`2/5 done`), and the board card shows `✓ 2/5`.
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
- In the TUI, the Story screen gets a **Comments** tab: `c` add, `e` edit (both open the Comment form), `d` delete.
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
| `GITIGNORE_INCOMPLETE` | info | A Data Root `.gitignore` that does not list `local.json`, `.lock`, `.lock.break` and `.txn/` | Adds the missing lines |
| `<PLUGIN>_…` | any | The checks of a Plugin that is on, such as `EPICS_MISSING_EPIC` or `TASKS_COUNTER_BEHIND` | As the Plugin says |

Story Keys are allocated as the highest number on the Board + 1 without a shared counter, so two branches can create the same key. After the merge, `rowbly doctor --fix` keeps the earlier Story and renumbers the other one (for example `WEB-4` and `WEB-5`), moving its folder with its Plugin files; its Task Ids follow the new key. Then `git add .rowbly` and commit the merge as usual. Renumbering changes a Story Key, so update any branch names or commit messages that used it.

In the TUI, open **Doctor** from the settings (`,`): `f` fixes and `r` checks again.
<!-- END doctor -->

<!-- BEGIN plugins -->
### Plugins

Plugins add optional features to Rowbly. Every Plugin ships with Rowbly (a Built-in Plugin) and is off until the Data Root turns it on, for everyone who uses it. The design is in [the plugin system](docs/plugins/README.md) and the [Built-in Plugins](docs/plugins/built-in.md) page; to write one, follow [Writing a Plugin](docs/plugins/writing-a-plugin.md) and the [Plugin API reference](docs/plugins/api.md).

```text
rowbly plugins list            # every Built-in Plugin, whether it is on, and any that failed to load
rowbly plugins show <id>       # a Plugin and its stored settings
rowbly plugins enable <id>
rowbly plugins disable <id>    # keeps its settings and data
```

- A Plugin is on when its entry in `rowbly.config.json` has `"enabled": true`; its settings sit beside it, and a Board can change them in its own `board.config.json` (`"plugins": { "<id>": { … } }`). Edit settings by hand and keep `enabled`; a Plugin that needs a setting refuses `plugins enable` until it is there ([Settings](docs/plugins/README.md#settings)). `rowbly init` turns no Plugins on. Command mode reads the configuration on every run; the TUI when it starts and when you turn a Plugin on or off.
- A Plugin that is on adds commands under `rowbly <id>`, options on core commands (in their `--help`), rows to `stories show`, and checks to `doctor`. It keeps its values on records as `"plugins": { "<id>": { … } }` and its files in `plugins/<id>/` folders. Rowbly keeps both unchanged while the Plugin is off, and `--json` prints records with them.
- A Plugin that fails to load (its settings are invalid, it throws while it starts, it clashes with a name already in use, or this version of Rowbly does not have it) is skipped with a warning, and `plugins list` and `doctor` report it. Its data is kept.
- A Plugin can refuse a change (exit 4). An expected error from a Plugin keeps its own code, such as `VALIDATION` (exit 2) for bad input. If a Plugin fails unexpectedly while handling a change, nothing is saved and the command exits 1; the error names the Plugin and says how to turn it off. With `--json`, these errors carry `details.plugin` and `details.stage`.
- `ROWBLY_DEBUG=trace` prints each operation and Plugin step, with its time and outcome, to stderr.
- In the TUI, the **Plugins** section of the settings (`,`) turns Plugins on and off (`enter`).
<!-- END plugins -->

<!-- BEGIN tui -->
## Interactive mode (TUI)

Run `rowbly` with no command in a terminal to open the full-screen app; global flags such as `--root` still apply. Without a terminal `rowbly` prints help and exits 2. With no Data Root, a first-run screen offers to create one here or globally. With a Board in context (`rowbly use <board>`, or the only Board in the Data Root) the app opens on that Board's Kanban board; otherwise it opens the home menu.

The board shows the Board's Stages side by side, in Stage order. Each Stage header shows its name coloured by Stage Category and its number of Stories; Stories are in Rank order and show the Story Key, Priority, name and what Plugins add, such as Assignees and how many Tasks are done (`✓ 1/3`). When the Stages do not fit the terminal width the board scrolls sideways (`‹2` / `3›` count the hidden Stages), and a long Stage scrolls up and down. Moves show at once; if a change cannot be saved, the Story goes back where it was and an error is shown. The board reloads from disk when you come back to it from another screen.

Screens and dialogs open in centred modals that fit their content from the first frame, up to the available height. Longer content is clipped while the modal's title and key hints stay visible.

### Keys on every screen

| Key | Action |
| --- | --- |
| `↑`/`↓` (or `j`/`k`) | move |
| `enter` | select or open |
| `/` | filter a list by typing (on the board and the Stories list: open the filter form) |
| `esc` | back (or cancel the open form) |
| `,` | settings, in a sidebar grouped into Global (Boards, global Stages and Fields, Context, Doctor, Plugins, and the sections Plugins add) and the Board in context (Config, Stages, Fields). `↑`/`↓` pick a section, `tab` (or `enter`) moves between the sidebar and the section |
| `?` | the keys of the current screen |
| `q` | quit (from the first screen) |

In a form, `enter`, `tab` and `↓` move to the next field and `shift+tab` and `↑` to the previous one; after the last field comes the Save button, where `enter` saves. `ctrl+enter` saves from any field; terminals without the kitty keyboard protocol send it as a plain `enter`, so `ctrl+s` saves there too. Text fields edit at the caret (`←`/`→`, `home`/`end`). Descriptions are written in place in a multi-line text box: `enter` starts a new line, and `↑`/`↓` leave the box from its first and last lines. `ctrl+f`, or a click on the **[Full screen]** button below the box, opens the text in a modal that fills the terminal, titled with the field's name; `esc`, `ctrl+f` or a click on the `✕` in its border closes it and keeps what you wrote. `space` toggles a yes/no field or a multi-choice option, and `←`/`→` change a choice.

### Keys per screen

The arrow keys are the main keys; the vim keys work too. `h`/`j`/`k`/`l` stand in for `←`/`↓`/`↑`/`→`, and `H`/`J`/`K`/`L` for `shift` with those arrows (on the board and the Stages screen).

| Screen | Keys |
| --- | --- |
| Board | `←`/`→` previous / next Stage, `↑`/`↓` previous / next Story, `enter` open, `shift+←`/`shift+→` move the Story to the previous / next Stage (bottom), `shift+↑`/`shift+↓` move it up / down in its Stage, `T`/`B` move it to the top / bottom of its Stage, `n` new Story in this Stage, `e` edit, `d` delete, `/` filter by Labels, Priorities, text and the filters Plugins add (several values per field), `c` clear the filter, `r` reload |
| Stories | `enter` open, `n` new, `/` filter by Stages, Labels, Priorities, text, Stage Category, open only and the filters Plugins add, and sort, `c` clear the filter, `A` all Boards / this Board only |
| Story | `tab`/`←`/`→` switch between Details and the tabs Plugins add, `e` edit, `m` move to a Stage, `d` delete |
| Story › Tasks (Tasks Plugin) | `enter` open, `n` new, `e` edit, `m` move to a Stage, `d` delete |
| Task (Tasks Plugin) | `e` edit, `m` move to a Stage, `d` delete |
| Assignees (Plugin) | `enter` open (then: Edit, Remove), `n` add |
| Boards | `enter` open the Board detail, `v` view its board without changing the context, `s` Stages, `f` Custom Fields, `n` new, `e` edit, `d` delete |
| Board detail (and Config) | `v` view its board, `o` its Stories list (both without changing the context), `s` Stages, `f` Custom Fields |
| Stages | `n` add, `e` edit, `shift+↑`/`shift+↓` move up / down, `T`/`B` move first / last, `d` remove (asks where to move Stories still in it), `l` switch level |
| Fields | `n` add, `e` edit, `d` remove, `l` switch level |
| Context | `enter` switch Board (or create the global Data Root while it does not exist), `m` set Me, `c` clear the current Board |
| Doctor | `f` fix, `r` check again |
| Plugins | `enter` turn the Plugin on or off |

Plugins that are on can add home menu entries, screens, fields to the Story form and filter, tabs and rows to the Story screen, badges to board cards, and sections to the Board detail. A Plugin's **Actions** are keys that show in the footer, the help (`?`) and as buttons in the header wherever the Board or Story they act on is in focus.
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
| `pnpm test` | Run every vitest project; the `cli` project builds the CLIs into its own `.test-dist/run-*` folder first |
| `pnpm test:unit` | Run the suites that need no CLI build (services, storage, TUI) |
| `pnpm test:cli` | Run the suites that spawn a built CLI; builds the CLIs into `.test-dist/run-*` first |
| `pnpm test:watch` | vitest in watch mode |
| `pnpm bench:plugins` | Opt-in Plugin benchmark (see [`test/performance/README.md`](test/performance/README.md)) |

How Rowbly is built is in [`docs/`](docs/README.md): the [architecture](docs/architecture/overview.md), the [plugin system](docs/plugins/README.md), the [development guide](docs/development/README.md) and the [decisions](docs/agents/adr/README.md). Use the terms in [`CONTEXT.md`](docs/agents/CONTEXT.md).

The test projects, helpers and rules are in the [development guide](docs/development/README.md#tests).
