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

Each CLI command opens the first of:

1. `--data-root <path>`, the `.rowbly` folder itself (`--data-root ~/notes/.rowbly`, not `~/notes`).
2. The known Data Root marked `"default": true` in the Home Config, `~/.rowblyrc.json` (see below).
3. `.rowbly/` in the current directory or the nearest parent, like git looks for `.git`.
4. `~/.rowbly` (create it with `rowbly init --global`).

With none of these a command exits 5 (`NO_DATA_ROOT`). If the Data Root named by `--data-root` or by the default is missing, Rowbly exits 5 naming it rather than opening another one. If several known Data Roots are marked default, commands without `--data-root` exit 2 listing them; keep one, or pass `--data-root`. `rowbly doctor --data-root <path>` reports them as `MULTIPLE_DEFAULT_DATA_ROOTS` and never picks one for you. `ROWBLY_ROOT` and `--root` are no longer supported: a run with `ROWBLY_ROOT` set exits 2 asking you to unset it.

The TUI uses `--data-root` when given; otherwise it opens the nearest `.rowbly/` in the current
directory or a parent. Outside one, it asks you to choose from the known Data Roots in
`~/.rowblyrc.json`, even when a default exists. The default appears first, other roots keep their
registered order and missing ones come after them, below **+ New Data Root**, which is pinned at the
top. Paths, labels and
`missing` markers help identify roots. Picking a missing one says that the Data Root no longer exists
and asks to delete it from the list (its entry in `~/.rowblyrc.json`). Use `↑`/`↓` and `enter`, or
click a row; when the list is longer than the window, the Data Roots scroll below the button:
`page up`/`page down` move the highlight a page and the mouse wheel three rows at a time. `n` opens the existing setup flow. Type to search:
`/` or any other key except the shell's (`q`, `?`, `,`, `D`) starts the search line above the list,
which fuzzy-matches each root's name, full path and `~` path, so `crew` finds a root labelled
Crewsum and `row-14` a root whose path holds it. Each change highlights the best match; **+ New Data
Root** stays below the matches, with `No matching Data Roots.` when there are none. While the search
has focus every key is text, `↑`/`↓` move and `enter` opens; `esc` clears it and shows every root
again. A failed open keeps the picker available. Selection comes before incomplete global onboarding,
followed by the selected Data Root's onboarding. With no known Data Roots, the existing home-folder fallback and
first-run onboarding/setup apply. An explicit missing `--data-root` still fails before onboarding.

```text
.rowbly/
  rowbly.config.json                 # optional Stages / Custom Fields, Plugin entries
  local.json                         # Local State (git-ignored)
  .gitignore                         # keeps local.json out of git
  ROWBLY.md                          # optional: how you work with these Boards, for agents (below)
  plugins/<id>/                      # files of a Plugin, for the whole Data Root
  boards/<board>/
    board.config.json                # name, key prefix, optional Stages / Custom Fields
    plugins/<id>/                    # files of a Plugin, for this Board
    stories/<KEY>/
      story.json                     # one Story, with its Plugin Data (e.g. its Tasks)
      plugins/<id>/                  # files of a Plugin, for this Story
```

Rowbly also keeps a per-user Home Config, `~/.rowblyrc.json`, outside every Data Root. Every run of `rowbly` creates it as `{ "version": 1 }` when it is missing and never replaces an existing one. Rowbly keeps keys it does not know when it changes the file, and changes a symlinked one at its target. If the file is not valid JSON, Rowbly leaves it alone and a command that needs it fails with exit code 6 naming the file; fix or move it.

Its `dataRoots` list holds the Data Roots you use, each `{ "label"?, "path", "default"? }`. Rowbly adds every Data Root it opens or creates (one with a `rowbly.config.json`), once per folder even when you reach it through a symlink or `~`, and never changes a label or the default when it does. Mark one entry `"default": true` to use it for commands from any folder and list it first in the TUI startup picker. When the home folder cannot be written, a command that would add a new Data Root warns and still runs.

`ROWBLY.md` is an optional Markdown file you write by hand to record how you work with these Boards: what each Stage means, when a Story moves, which Labels and Comments you expect. Rowbly does not parse or enforce it (only `software-factory brief` copies it, as text, into an agent's brief), but the Rowbly agent skill and reference tell an agent to read it before changing data and to follow it. Commit it with the rest of `.rowbly/`; `rowbly doctor` treats it as part of the Data Root.

Commit `.rowbly/` with your code; `init` writes a `.gitignore` that keeps `local.json` and Rowbly's lock and commit files (`.lock`, `.lock.break`, `.txn/`) out. Each Story is its own folder, so most changes touch one small file and merge cleanly.

- **Story Keys** are the highest number on the Board plus one. There is no shared counter, so two branches can both create `WEB-7`. After such a merge, run `rowbly doctor --fix`: it keeps the earlier Story as `WEB-7` and renumbers the other one (its Task Ids follow, as they start with the Story Key). Update branch names or commit messages that used the renumbered key.
- **Deleted keys may be reused.** If the highest-numbered Story is deleted, the next new Story gets its number. git history still shows which Story a key meant at any time.
- **Run `rowbly doctor` after every merge** that touched `.rowbly/`. It reports conflict markers, invalid files, references to Stages that no longer exist, and other drift, and `--fix` repairs what is safe to repair. See [Doctor](#doctor).

## Configuration Cascade

Stages and Custom Fields are configuration, not data. Each list can be defined at two levels:

1. `rowbly.config.json` (global),
2. `board.config.json` (Board).

A Board uses the most specific level that defines the list; the lists are not merged. With no list anywhere, a Board has the built-in Stages `todo` (TODO) and `in-progress` (In Progress) between Backlog and Done, and no Custom Fields. A `stages` list holds only the Stages between Backlog and Done, as `{ "key", "name" }`; it never names `backlog` or `done`.

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
  there. `--default` makes it the default Data Root for commands from every directory unless `--data-root`
  names another; any other Data Root marked default stops being the default in the same write. In an
  interactive terminal `init` asks whether to make it the default; it does not ask for a label. Without `--default` the defaults stay as they are, and `init` warns when another default
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
- In the TUI, **+ New Data Root** in the startup picker opens setup; with no known Data Roots, first-run setup follows global onboarding when no Data Root is found. It offers the same three locations
  as `init` (this directory, the home folder, or another folder whose path you type; `esc` goes back to
  the choice), then asks whether to make it the default Data Root, the first Board and your handle,
  which becomes global Me (`~/.rowblyrc.json`). It does not ask for a label: the Data Root switcher's `e`
  sets one later. Leave the Board or the handle empty to skip it; an empty handle keeps the global Me you have. The **Me** section of the settings
  (`,`) shows Me and lists its two levels, **Global** (`~/.rowblyrc.json`) and **This Data Root**
  (`local.json`): `enter` edits the highlighted one; save a handle, or save it empty to clear that
  level. The Board sidebar switches the Board. The home menu's **Context** entry also switches it; press
  `c` there to clear the current Board. While `~/.rowbly` does not exist, Context also lists **Create global
  Data Root**, which runs the same form as the first-run screen (`init --global`) and then returns to the
  Data Root you are using.
- In the TUI, the button at the far left of the header names the Data Root that is open: its label in
  `~/.rowblyrc.json`, else **Global** for `~/.rowbly`, else the folder that holds it. Click it, or press
  `D`, to open the Data Root switcher. It lists the known Data Roots with their paths and marks the
  `current` one, the `default` one and any that are `missing`; missing ones are listed last. Type to
  search them, as in the startup picker: `/` or any key except `n`, `e` and `d` starts the search, and
  `esc` clears it (`esc` again closes the switcher). `enter` (or a click) opens the
  highlighted one with its own Boards, Plugins and Me, on the home screen; the screens, filters and
  sidebar picks of the previous one close. Switching changes nothing in `~/.rowblyrc.json`: the labels
  and the default stay as they are; the next TUI launch follows the startup choice described above. Picking a missing Data
  Root (moved or removed) says that it no longer exists and asks to delete it from the list, which takes
  its entry out of `~/.rowblyrc.json`; one that cannot be opened for another reason (broken) shows an
  error. Either way the app stays where it was. The
  button pinned at the top, **+ New Data Root** (or `n`), runs the setup form and opens the new Data Root; a long
  list scrolls below it, with the same keys and wheel as the startup picker. While a form holds
  unsaved changes, both ask before discarding them; `D` is typed as text while a text field has focus.
  `e` edits the highlighted Data Root's label and whether it is the default (an empty label removes
  it; making one the default clears the others). `d` asks how to remove it: **Forget it** takes its
  entry out of `~/.rowblyrc.json` and leaves its folder (opening it again adds it back); **Delete it**
  asks once more, then deletes the folder with every Board, Story and Plugin file in it, and fails while
  another Rowbly process is writing there. A missing one can only be forgotten, and the Data Root that
  is open cannot be removed.
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
rowbly boards stats [<id>]                            # all-time current-record Stats
rowbly boards show [<id>]                             # effective Stages and Custom Fields, their source level, Stories per Stage
rowbly boards edit <id> [--name <n>] [--description <text>]
rowbly boards delete <id> [--force]                  # confirms; pass --yes when not interactive
```

- The key prefix (`WEB` in `WEB-42`) must be unique across the whole Data Root; a clash exits 4. Lower case is accepted and upper-cased.
- A new Board has no Stage or Custom Field lists of its own: it inherits them through the Configuration Cascade.
- `delete` refuses a Board that has Stories (exit 4) unless `--force`. Deleting the current Board clears it from Local State.
- In the TUI, **Boards** `enter` opens the Board detail (`boards show`): name, key prefix, description, Stories per Stage, and the effective Stages and Custom Fields with their source level. `v` opens a Board's board for viewing only, like `--board` on a read command: the current context and `local.json` do not change.

**Board Stats.** `rowbly boards stats [id]` uses the named Board or the current Board. In the TUI,
open **Settings → Board → Stats**, or press `t` in Board details. Press `r` to refresh; there is no
background polling. A refresh keeps the previous results visible and cancels its old request.
Leaving the page or replacing the Data Root cancels its requests.

- **Stories** counts existing Stories. **Stories currently Done** counts those whose current Stage
  Category is `done`. Both cover all time and exclude deleted Stories and historical transitions.
- With GitHub on, **Linked PRs** counts unique PR identities currently linked to this Board's
  Stories, including open, closed and merged PRs. **Commits in linked PRs** deduplicates their full
  commit SHAs. PRs no longer linked to existing Stories are excluded.
- GitHub needs `gh` installed and authenticated for the linked hosts. Equivalent URLs and returned
  PR identities are deduplicated. A complete empty source is `0`; missing access, unreadable links,
  failed reads and bounds show **unavailable** or **N known (partial)** with a reason. Off Plugins
  show unavailable metrics without inspecting their preserved bags. Partial values are lower
  bounds, never estimates of the total.
- GitHub refreshes use at most two requests concurrently, 100 candidate PRs, 10 pages per PR,
  200 pages overall and 30 seconds. Each page has at most 100 commits. A changed or incomplete PR
  contributes no commit count through any linked alias. A changed PR identity also makes the
  linked-PR count incomplete. Local records and live GitHub reads are not one atomic snapshot.
- `--json` returns `{board: {id, name}, window: "all-time", metrics, plugins: [{id, name, metrics}]}`.
  Metrics contain `key`, `label`, `status` (`complete`, `partial`, `unavailable`), `value` (a count,
  or `null` when unavailable) and a `reason` for partial/unavailable results. Source failures are
  represented in a successful result; an unreadable Board/Data Root remains a command error.

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
                      [--task <name>…] [--spec <slug>…] [--story-spec <slug>=<file>…]
                      [--blocks <KEY>…] [--blocked-by <KEY>…]
rowbly stories show <KEY>
rowbly stories edit <KEY> [--name <n>] [description flags]
                    [--priority <P> | --no-priority]
                    [--label <l>… | --add-label <l>… | --remove-label <l>…]
                    [--due <date> | --no-due] [--field key=value …] [--unset-field <key>…]
rowbly stories move <KEY> <stage> [--top] [--finished-run <stage>/<attempt>/<startedAt>]
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

<!-- BEGIN story-linking -->
### Story Linking

Enable **Story Linking** to record blocking relationships between Stories on the same Board:

```text
rowbly plugins enable story-linking
rowbly story-linking add WEB-1 --blocks WEB-2
rowbly story-linking add WEB-3 --blocked-by WEB-1
rowbly story-linking list WEB-1
rowbly story-linking list WEB-2
rowbly story-linking remove WEB-2 --blocked-by WEB-1 --yes
```

- Both Stories show the relationship: **Blocks WEB-2** on WEB-1, **Blocked by WEB-1** on WEB-2.
  A Story can have several links in each direction, including both directions at once. Links do not
  restrict Stage changes, and cycles are allowed.
- `add` and `remove` take exactly one of `--blocks <KEY>` and `--blocked-by <KEY>`. Keys are
  case-insensitive. Adding requires two existing Stories on the same Board; cross-Board and self
  links exit 2, and a missing Story exits 3. Adding the same link again leaves data unchanged.
- Removing from either Story changes the one saved relationship. `remove` confirms unless `--yes`
  is given; a missing relationship exits 3. Remove an outgoing link to a deleted Story with
  `remove <existing blocker> --blocks <missing KEY>`.
- `list --json` returns `{ relation, key, name, available }` entries, with direction `blocks` or
  `blocked-by` relative to the Story inspected. Missing targets have `name: null`, `available: false`.
  `add` and `remove` return `{ blocker, blocked }`. `stories show` adds direction rows; its JSON
  remains the stored Story, with outgoing links in `plugins["story-linking"].blocks`.
- In the Story's **Links** tab, use `↑`/`↓` to select and `enter` or a click to open the linked Story;
  `esc` returns and `/` filters. `n` opens the new-link form: choose **Blocks** or **Blocked by**,
  choose a Story on this Board, and press `ctrl+s`. `d` removes a link after confirmation.
- Disabling hides the commands and tab and keeps all links. With the Plugin on, deleting a Story
  removes its incoming references atomically. If it was off during deletion, remove or repair stale
  links after re-enabling. An invalid linking bag on the Board makes `list` and Story deletion exit 6;
  mutations never overwrite invalid bags, and the TUI marks incomplete link data explicitly.
- Doctor's `STORY_LINKING_INVALID_TARGET` reports missing, cross-Board and self targets; `--fix`
  removes them, keeping other Plugin Data. Inspect links after Story Key reuse or doctor renumbering:
  the old key cannot identify which Story was intended. See [Story Linking details](plugins/built-in.md#story-linking).
<!-- END story-linking -->

<!-- BEGIN attachments -->
### Attachments

Enable the Built-in Plugin with `rowbly plugins enable attachments`.

```text
rowbly attachments add <KEY> <file>
rowbly attachments add <KEY> --from-clipboard
rowbly attachments list <KEY> [--json]
rowbly attachments remove <KEY> <id>     # confirms; pass --yes when not interactive
rowbly attachments open <KEY> <id>
```

- Attachments are PNG images, at most 10 MiB, on Stories. Give exactly one source when adding.
  A file keeps its basename; a clipboard image is named `image-YYYYMMDD-HHMM.png` (UTC).
  Clipboard failure reports a reason and saves nothing.
- `list --json` returns an ordered array of `{ id, name, type, size, createdAt, createdBy }`;
  `type` is `image/png`, `size` is bytes, and `createdBy` is Me or `null`. `add --json` returns one
  entry, `remove --json` returns `{ removed }`, and `open --json` returns `{ opened }`.
- `open` uses `open` on macOS, `start` on Windows or `xdg-open` on Linux; it requires an available
  associated application. The PNG and Story bag save or delete together. Disabling keeps both.
- An invalid bag exits 6 and doctor reports `PLUGIN_DATA_INVALID`; repair by hand without dropping
  entries or files. A Story tab and paste handling are planned.

<!-- END attachments -->

<!-- BEGIN software-factory -->
### GitHub PR

Enable the `github` Plugin to link one GitHub PR per Story. The URL may use GitHub.com or an
Enterprise host; it must be HTTPS with `/owner/repository/pull/<positive integer>`. Credentials,
ports, query/fragment, dot segments, encoded separators and extra path parts are refused.

```text
rowbly plugins enable github
rowbly stories create --board web --name "Sign in" --github-pr https://github.com/octo/app/pull/123
rowbly stories edit WEB-1 --github-pr https://github.com/octo/app/pull/123
rowbly stories edit WEB-1 --github-pr ''
rowbly github status WEB-1 --json --no-prompt
```

The Story form's **GitHub PR** field sets the same link; clearing it removes a supported value.
Details and `stories show` display the stored URL without a network read. The **GitHub PR** Story
tab fetches immediately, every 60 seconds while active, and on `r`. It shows PR/draft, checks,
review and merge information plus fetch time; failed refreshes keep and label the last result.
Leaving the tab or active screen, disabling/reloading the Plugin, or switching Data Roots cancels
its work. Nothing polls in CLI hooks or saves live status.

`github status` fetches once using an installed, authenticated `gh` (`gh auth login`); it never
starts login itself. Missing links exit 3. Missing tools, access/authentication failures, output
limits (1 MiB stdout, 64 KiB stderr), unreadable responses and a 10-second timeout report errors.
`--json` returns PR details and `checks: { total, passed, failed, pending, other }`, plus `fetchedAt`;
empty or unknown check results never mean passed. See [GitHub Plugin](plugins/built-in.md#github)
for the full JSON fields and resource limits.

An invalid or future bag is unavailable, preserved by unrelated edits and refused by explicit
replacement/clearing (exit 6). Doctor warns `PLUGIN_DATA_INVALID` without fixing it. Repair it by
hand. The Plugin has no settings, background CLI polling or saved status cache.

### Software Factory

Software Factory is a Built-in Plugin: run `rowbly plugins enable software-factory` first. It gives
each Stage, Backlog and Done included, a Markdown **Stage Prompt** that tells an agent what to do
with a Story in that Stage. Each Stage Prompt is on or off; all are off by default. A **Stage Run**
records one agent's work on a Story during its current visit to such a Stage, so an agent that
watches the Board knows what is already being worked.

```text
rowbly software-factory stages [--board <id>] [--level board|global]   # every Stage with its Stage Prompt
rowbly software-factory setup [--board <id>] [--prompts default|minimal]   # add missing factory Stages and Stage Prompts
rowbly software-factory prompt show <stage> [--board <id>] [--level board|global]
rowbly software-factory prompt enable <stage> [--board <id>] [--level board|global]
rowbly software-factory prompt disable <stage> [--board <id>] [--level board|global]
rowbly software-factory prompt edit <stage> [--text <text>|--file <path|->|--edit] [--board <id>] [--level board|global]
rowbly software-factory prompt remove <stage> [--board <id>] [--level board|global]   # confirms; pass --yes when not interactive
rowbly software-factory runs [--board <id>] [--stale-after <minutes>]   # Stories in Stages whose Stage Prompt is on, with their Stage Runs
rowbly software-factory wait [--board <id>] [--since <digest>] [--timeout <seconds>] [--stale-after <minutes>]   # blocks until runs change
rowbly software-factory run start <story> --worker <name> [--retry] [--provider <id> --model <id> --rule <text> [--option <id>=<json>]... [--fallback <why>] [--usage <source>]]
rowbly software-factory run attach <story> --stage <stage> --attempt <number> --started-at <timestamp> --worker <id> --machine <name> --harness <name> --thread-id <id> --source <text>
rowbly software-factory run touch <story> --stage <stage> --attempt <number> --started-at <timestamp> --worker <id> --source <text>
rowbly software-factory run finish <story>
rowbly software-factory run fail <story> [--reason <text>]
rowbly software-factory run clear <story>
rowbly software-factory hold <story> --reason <text>   # no Stage Run starts until it is released
rowbly software-factory release <story>
rowbly software-factory apply <story> [--text <block>|--file <path|->] [--dry-run]   # check a worker's reported block, then run what it allows
rowbly software-factory brief <story> [--retry-file <path|->] [--instructions-file <path|->] [--allow-incomplete]
```

- Stage Prompts are set per Stage at the global level (`rowbly.config.json`) or on a Board
  (`board.config.json`). A Board's entry for a Stage replaces the global entry for that Stage; the
  other Stages keep the global one. Writes go to the Board level unless `--level global`.
- `setup --prompts minimal` writes the existing placeholder text with all new Stage Prompts off.
  Omitting `--prompts` uses `default`; other values give a usage error. Both choices keep existing
  Stages, entries and files, and running the other option later keeps the first prompts.
- `setup` gets a Board ready for a software factory: Backlog, TODO, In Progress, In Review, Done
  (a Board without a factory keeps Backlog, TODO, In Progress, Done). It adds the Stages `todo`
  (TODO), `in-progress` (In Progress) and `in-review` (In Review) that the Board does not have,
  after `todo` and `in-progress`, and writes a default Stage Prompt on the Board for each of those
  Stages that has no Stage Prompt at either level and no file yet. In Progress (build the Story to a
  draft PR with the `rowbly-dev` skill) and In Review (an independent review, then merge, or return
  to In Progress) are turned on. TODO (an advisory readiness review) stays off: it needs the
  Comments Plugin, Git, Node 22 or later and the `rowbly-factory` skill's fingerprint helper, and it
  reports an incomplete review for any input the helper does not know, so turn it on with
  `prompt enable todo` once those are in place. Setup never renames, moves or removes a Stage (a
  Stage with a factory key keeps its own name), and never replaces a Stage Prompt entry, on or
  off, at the Board or the global level, or a file: it lists what it `added`, `kept` or `skipped`.
  When nothing is missing it writes nothing, so it can run again. It exits 4 (`CONFLICT`) and saves
  nothing when another Stage already has a missing factory Stage's name. The defaults name only
  published skills, `git` and `gh`; edit them for your repository's branch, merge method and
  screenshots, or say those in `ROWBLY.md`.
  `--json` returns `{ board, stages: [{ key, name, outcome }], prompts: [{ key, outcome, source, enabled, path, reason? }] }`.
- Files are `.rowbly/plugins/software-factory/stage-prompts/<key>.md` (global) and
  `.rowbly/boards/<board>/plugins/software-factory/stage-prompts/<key>.md`; the setting records the
  path relative to the Data Root.
- `enable` writes a template when the Stage Prompt has no file (on a Board, a copy of the global
  Stage Prompt's file for that Stage when there is one); `disable` keeps the file; `edit`
  replaces the text (and creates the file); `remove` deletes the entry and file at that level.
  `enable`, `disable` and `edit` exit 3 (`NOT_FOUND`) for a Stage that level does not have.
- `stages --json` returns `{ board, stagesSource, stages: [{ key, name, category, prompt: { enabled, configured, source, path, exists, text } }] }`.
  `enabled` is true only when the setting is on (`configured`), the path is inside the Plugin's
  folder for its level, and the file exists. A file that cannot be read, such as a symbolic link,
  counts as missing, and `remove` leaves it in place. `source` is `board`, `global` or `null`.
- A Stage Run is `running`, `finished` or `failed`, with an attempt number and the worker's name.
  Moving the Story to another Stage removes it, so the Stage is worked again on the next visit.
  `run start` exits 4 (`CONFLICT`) when the Story's Stage has no Stage Prompt that is on, or the
  Story already has a Stage Run there; `--retry` starts a failed one again. `run clear` removes it.
- An advisory Stage Prompt can finish a readiness review and leave the Story in its current Stage.
  Comments and requirement edits do not restart its finished Run. After supplying new input, a
  person can request another pass with `rowbly software-factory run clear <KEY>`; clearing the Run
  leaves the Story in place. The supervisor leaves finished Runs alone. Duplicate review suppression
  belongs to the Stage Prompt: it needs complete, known and unchanged review inputs, not just the
  same Comment count or latest timestamp. A filtered CLI list cannot establish completeness when
  it omits unsafe files; an incomplete input must prevent skipping the review. A readiness helper
  must also compare its original reviewed Story with a final read, including when Story Linking is
  off, and detect changes to its other review inputs during collection. Rowbly does not compare
  readiness fingerprints itself.
- `stories move <KEY> <stage> --finished-run <stage>/<attempt>/<startedAt>` moves the Story only
  while that Stage Run (its Stage, attempt and `startedAt`) is still the finished Stage Run of the
  Story's current visit, checked when the move is saved; otherwise it exits 4 (`CONFLICT`) and
  changes nothing.
- `runs --json` returns `{ board, stages, stories: [{ key, name, stage, stageRun, liveness, runMetadata, eligibility }], staleAfterMinutes, digest }`.
  `digest` is a short hash of `stages`, `staleAfterMinutes` and `stories` without each Run's age:
  it changes whenever they do, but not as time passes.
- `apply` is for a factory supervisor. It reads a worker's reported `rowbly` block (the lines in
  ```` ```rowbly ```` fences, else every line) and decides each line: `apply`, `hold`, `drop` or
  `reject`. A line may only edit or move the Story given, or change its Comments, Tasks, Story
  Specs or the links it blocks (`story-linking add|remove <KEY> --blocks`); it is split with shell
  quoting but never run by a shell. Shell syntax (`;`, `|`, `$(…)`, …), another Story, a line that
  writes another Story (`--blocked-by`), `software-factory` commands and options such as
  `--data-root`, `--yes`, `--edit`, `--*-file` or `--finished-run` are rejected, and then nothing
  runs (exit 2, every line's decision in `details.commands`). A `stories move` runs last and only
  once the Story's Stage Run is finished; it is held while the Stage Run runs or when there is none,
  and dropped after a failed one. `apply` runs it with `--finished-run`, so it exits 4 (`CONFLICT`)
  and moves nothing when the Stage Run was cleared or replaced while the earlier lines ran. Each allowed line runs as its own `rowbly` command on the same Data Root with
  `--json --no-prompt`; the first that fails stops the block, the lines before it stay applied, and
  `apply` exits with that command's code. `--dry-run` only shows the decisions.
  `--json` returns `{ key, stageRun, dryRun, commands: [{ line, text, argv, decision, reason?, exitCode?, output? }] }`.
- `wait` blocks until `runs` differs from `--since <digest>` (without it, from `runs` when the wait
  starts), then prints `runs` with `changed: true`. That happens when a Story enters or leaves a
  Stage whose Stage Prompt is on, a Stage Prompt is turned on or off, or a Stage Run starts, ends or
  is cleared, or eligibility changes (for example, a blocker reaches Done); Comments do not count.
  It watches the Data Root for changes by any process, and checks once at the start, so a change
  made before it began is not missed. With
  `--timeout`, it stops after that many seconds and prints `runs` with `changed: false`; exit 0 either
  way. `ctrl+c` (or `SIGTERM`) stops it with nothing changed (exit 130 or 143).
- `brief` prints what an agent needs to work the Story in its Stage, as Markdown: the Story with
  everything each Plugin that is on keeps about it (Specs, Tasks, Comments, Epic, Story links,
  Attachments, Assignees), the Stage Prompt, the Board's Stages, and the text of
  `--instructions-file` and `--retry-file`, and the Data Root's `ROWBLY.md` as it is written ("None."
  without one; it is only copied, never followed by Rowbly). It exits 4 (`CONFLICT`) when the Stage
  has no Stage Prompt that is on, and when part of the Story cannot be read (a Plugin that did not
  load, invalid Plugin Data), `ROWBLY.md` cannot be read (a symbolic link, not a file) or a retry has
  no `--retry-file`, with each gap in `details.incomplete`; `--allow-incomplete` prints it anyway, with
  the gaps listed at the top. `--json` returns `{ key, board, stage, attempt, complete, incomplete, sections, markdown }`.
- In the TUI, **Stage Prompts** in the settings (`,`) lists the Stages with their Stage Prompts,
  **Factory setup** in a Board's settings runs `setup` for that Board and lists the result, and
  the Story screen shows the Story's **Stage Run**. A Story whose Stage Run for its current Stage is
  running or failed has a badge on its board card and list line, `▶ running` or `✕ failed`, with
  `#2` after the first attempt. The Story's **Stage Run** tab shows it in full: outcome,
  attempt, worker, who started it, when it started and ended (with how long ago), how long it ran,
  when its worker was last seen while it runs, and the failure reason.

**Model Selection.** `run start`, including `--retry`, can record the model the supervisor chose for
the worker before its launch: `--provider`, `--model` and `--rule` (the model policy rule applied)
together, with `--option <id>=<json>` (repeatable; unique IDs, JSON string, finite number or boolean),
`--fallback <why>` when the rule's model is not used, and `--usage` (`unknown`, the default,
`observed-limit` or `user-stated`). An incomplete group exits 2. Rowbly adds `selectedBy` (Me) and
`selectedAt` (the Run's start), saves it as the current Run's `selection` in `run-metadata.json` in
the same operation as the start, and returns it as `selection`. It records intent, not what
launched: the supervisor compares the launch receipt with it and fails the Run on a difference,
leaving it unchanged. Rowbly has no usage source and records no quota. The `runs` table shows it in
a Model column and `stories show` in a Model Selection row; without the flags a start records none.

Option values are JSON scalars: `--option 'reasoningEffort="high"'`, `--option 'text="123"'`,
`--option 'number=1e3'` (number `1000`), `--option 'textBoolean="true"'` and
`--option 'fastMode=true'`. Keep the JSON quotes around strings inside the shell argument.
Malformed JSON, null, arrays, objects, nonfinite numbers and duplicate option IDs exit 2 before
starting a Run. Copy IDs and typed values from the harness's catalog; Rowbly does not infer which
options a model supports. These flags are new; existing saved selections and starts without them
need no migration.

`run attach` records supervisor-attested launch verification; Rowbly does not contact the harness.
Copy `stage`, `attempt` and `startedAt` from the successful start result, and supply the actual
worker ID, machine, harness, thread ID and verification source. Me and the operation clock supply
`verification.by` and `verifiedAt`. Attachment updates `stageRun.worker` atomically with the file.
A changed Run or conflicting identity is `CONFLICT` (exit 4). Repeating identical inputs writes
nothing, including no timestamp change. Attach requires a running Run; it can initialize absent or
recognized stale v1 metadata. Invalid or unsupported metadata refuses attachment with
`DATA_INTEGRITY` (exit 6) and remains unchanged.

`runs` includes `runMetadata: { status, current, ... }`. Status is `absent`, `valid`, `invalid` or
`unsupported`. A matching valid file includes `version`, `run` and its optional `identity`,
`selection` and `heartbeat`; a stale valid file has `current: false` and exposes none of those
sections. Invalid/unsupported output includes a diagnostic message. The table shows the verified
machine/harness/thread or says not recorded/unavailable. Human `stories show` and the TUI Story
Details show an attached worker identity; `stories show --json` remains the stored Story, and
`runs --json` is the structured metadata reader. Attachment changes the `runs` digest and wakes
`wait`.

`run touch` records a heartbeat: the supervisor's attestation that it verified the attached
worker's activity, such as a message from it or an event from its harness, described by
`--source`. Polling, a reachable worker or a harness status is not activity. Copy `stage`,
`attempt` and `startedAt` from the Run and give the attached worker; Me and the clock supply `by`
and `at`. Touch requires the current running Run with an attached identity for that worker,
otherwise `CONFLICT` (exit 4) with nothing written; it never attaches a worker. Invalid or
unsupported Run details refuse it with `DATA_INTEGRITY` (exit 6) and stay unchanged. A touch
replaces the heartbeat and keeps the identity and selection. `--json` returns
`{ key, stageRun, heartbeat: { worker, at, source, by } }`.

Each running row of `runs` has `liveness: { lastSeenAt, heartbeat, ageSeconds, stale }`;
other rows have `null`. `lastSeenAt` is the current Run's heartbeat time, or `null` with
`heartbeat: "none"` when none was reported, and the age then counts from `startedAt`.
`heartbeat: "unavailable"` means the Run details cannot be read. A Run is `stale` once its age
reaches `--stale-after <minutes>` (default 15), which `runs` and `wait` take; give both the same.
The table's **Last seen** column shows it, for example `4m ago` or `not reported, started 20m ago,
stale`, and the TUI's **Stage Run** tab shows a **Last seen** row. Staleness only tells the
supervisor to check the worker: Rowbly never clears, fails or retries a Run because of its age
([ADR-0048](agents/adr/0048-stage-run-heartbeats-are-attested-evidence.md)). The `digest`
leaves out `ageSeconds`, so reading again does not change it; a saved heartbeat does, and a Run
becoming stale does once (`wait` notices it at its next check, within a minute).

The strict v1 file is `boards/<board>/stories/<KEY>/plugins/software-factory/run-metadata.json`,
bound by `{stage, attempt, startedAt}`. Identity, selection and heartbeat are independently
optional; a heartbeat requires the same worker as identity. Same-Run writes preserve the other
sections' JSON values. `run start` writes selection; `run touch` writes the heartbeat. Every
start/retry resets recognized metadata, even without selection; finish/fail retains it. Clear and
Stage changes remove recognized v1 metadata. Explicit resets prevent old identity/activity from
returning when timestamps repeat. Unknown fields, future versions and unreadable files remain
unavailable and unchanged, including through clear/Stage changes; a new start refuses them until
explicit repair. Older releases preserve the file but do not maintain this lifecycle.

For launch and restart recovery: keep the launched worker waiting for GO, verify the actual
identity, attach it, publish the Board, then send GO. Resolve a recovered thread on its recorded
machine through its recorded harness. A legacy worker string or a title is only an unverified hint.
A confirmed failed launch uses `run fail --reason`; an uncertain launch, unreachable worker or
failed attachment/publication needs reconciliation before GO or another launch. Preserve the
previous attempt's metadata in retry context before replacing it.

`eligibility` is `{ eligible, reasons: [{ code, message, blockers? }] }`, separate from the Stage
Run. With Story Linking on, unfinished incoming blockers produce a `BLOCKED` reason and
`blockers: [{ key, name, stage }]`; the table shows the reason. `run start`, including `--retry`,
refuses them with exit 4 (`CONFLICT`) and `details.eligibility`, saving no Run or attempt change.
Moving each blocker to a Stage of category `done` restores eligibility on the next `runs` call;
links remain recorded. Supervisors skip blocked Stories and reconsider them after Board changes.
Invalid linking data fails explicitly (exit 6), and an enabled but unavailable provider fails the
query rather than reporting no blockers. With Story Linking off, its preserved data is ignored.
An eligible Story still needs the appropriate Stage Run state to start or retry.

`hold` keeps a Story out of Stage Runs, for example while you work it by hand: its eligibility
gets a `HELD` reason with your name and `--reason`, and `run start` refuses it (exit 4), `--retry`
included. The hold stays when the Story changes Stage, and neither `hold` nor `release` changes its
Stage Run; `release` makes it eligible again. `hold` exits 4 for a held Story and `release` exits 3
for one that is not. The hold is `.rowbly/boards/<board>/stories/<KEY>/plugins/software-factory/hold.json`;
a hold file this Rowbly cannot read (one with fields it does not know, or a symbolic link, which is
never followed) counts as held, and both commands exit 6 without changing it
(doctor: `SOFTWARE_FACTORY_UNREADABLE_HOLD`). The Story screen shows a **Hold** row while it is held.

With Software Factory on, each Stage heading in the Board's Stages view has a clickable `✎`.
It opens that Stage's effective Stage Prompt in the fullscreen viewer, including when the prompt
is off or missing (a missing file starts with a template). `tab` or `e` switches to editing;
`ctrl+s` saves, and closing unsaved edits asks before discarding them. Saving writes the shown
Board's own Stage Prompt, preserving its on/off setting; an inherited prompt becomes a Board
entry with the global entry's setting. Use Stage Prompts in Settings to change that setting.
<!-- END software-factory -->

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
| `STORY_LINKING_INVALID_TARGET` | warning | A Story link to a missing Story, another Board or itself | Removes the link, keeping other Plugin Data |
| `ATTACHMENTS_MISSING_FILE` | warning | An Attachment entry whose PNG is missing | Removes the entry from a valid bag |
| `ATTACHMENTS_ORPHAN_FILE` | warning | An Attachment file with no entry | — (preserves bytes for recovery) |
| `SOFTWARE_FACTORY_UNREADABLE_HOLD` | warning | A Story's hold file is not valid JSON, is invalid, has a `version` or fields this Rowbly does not support, or cannot be read (a symbolic link is not followed). The Story counts as held, and `hold` and `release` refuse to change the file | — (repair the file, or delete it to release the Story) |
| `SOFTWARE_FACTORY_RUN_METADATA_INVALID` | warning | Run metadata is unreadable or fails the strict v1 shape, including unknown fields or an inconsistent heartbeat | — (preserved; repair explicitly) |
| `SOFTWARE_FACTORY_RUN_METADATA_UNSUPPORTED_VERSION` | warning | Run metadata declares a version other than 1 | — (preserved; use a compatible Rowbly or repair explicitly) |
| `SOFTWARE_FACTORY_MISSING_PROMPT` | warning | A Stage Prompt that is on, at the global level or on a Board, whose path is not set, is outside the Plugin's folder, or whose file is missing or cannot be read (a symbolic link is not followed) | — (create the file with `prompt edit`, or turn it off) |
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
- `ROWBLY_DEBUG=trace` prints each operation and Plugin step, with its time and outcome, to stderr, and each wait for the Data Root lock, with how long it waited and for which operation. The TUI prints its last 1,000 lines when it exits, so run `ROWBLY_DEBUG=trace rowbly` to see what a slow screen waited for.
- In the TUI, the **Plugins** section of the settings (`,`) turns Plugins on and off (`enter`).
<!-- END plugins -->

<!-- BEGIN feature-flags -->
### Experimental Features

Open **Settings** (`,`) → **Global** → **Experimental Features** to see each feature's name,
on/off value and description. `enter` saves the opposite value; a toast confirms the save or
reports an error. This version has no Experimental Features, so the section explains that features
will appear when available and offers no toggle.

```sh
rowbly feature-flags list
rowbly feature-flags set <key> true
rowbly feature-flags set <key> false
```

`list --json` returns an array of `{ key, name, description, enabled }` with effective booleans;
`set --json` returns the changed entry. Use a key from `list`: an unknown key exits 3
(`NOT_FOUND`), and a value other than the literal `true` or `false` exits 2 (`USAGE`).
These commands need a Data Root, but no current Board. With no definitions, `list` returns `[]`.

Values are saved under `featureFlags` in the Data Root's `rowbly.config.json`, survive restarts and
apply to every Board there. They do not use Board settings or the Home Config. Missing keys use
the defaults defined by this version of Rowbly; explicit `false` values override defaults that are
on. Saved keys this version does not recognize are kept but not listed or accepted by `set`.
Code that uses a feature reads its current value; behavior that is already running may take until
its next check to reflect a change.

<!-- END feature-flags -->

<!-- BEGIN skills -->
### Skills

`rowbly skills` installs and starts agent skills that use Rowbly. The official skills are the skill
folders that ship in the npm package's `skills/` folder: today `rowbly`, which teaches an agent to run
Rowbly; `rowbly-dev`, which takes a Story from its Key to a draft pull request; `rowbly-factory`,
which works a Board's Stories with agents through its Stage Prompts; and `rowbly-grill`, which interviews a person about a Story and saves its specification and qualifying ADRs as Story
Specs. Invoke `$rowbly-grill WEB-42`, `/rowbly-grill WEB-42`, or name the skill with a Key
(case-insensitive); a bare number uses the current Board. Without a Key it asks, never chooses.
Specs must be enabled and loaded and the Story must have a description before the interview starts.
The browser form has a numbered chat fallback. The skill leaves the description and Stage unchanged
and grants no implementation permission. Install with
`rowbly skills install rowbly-grill --harness codex` (or `--harness claude`).

`rowbly-factory` runs a software factory on one Board. It needs the Software Factory Plugin, at least
one Stage Prompt that is on and written (not the template), and an agent harness that can start
threads. It starts a worker for each Story that arrives in such a Stage, up to 4 at once by default,
records a Stage Run for it, and is the only agent that changes the Board: workers report the
`rowbly` commands their Stage Prompt asks for, and it checks and applies them with
`rowbly software-factory apply`. A failed Stage Run is retried
once unless `ROWBLY.md` or the Stage Prompt says otherwise. Before starting the retry, the supervisor
captures the previous Run and recovers existing work from the Story, Comments and identified worker's
messages: outcome, failure reason, branch, worktree/machine and PR when known, with sources and
verification limits. It saves that context as a Comment when Comments are on (otherwise in its
messages and brief), before the retry replaces the failed Run. The retry brief explicitly says
whether to continue the existing work or start again, identifies the instruction authorizing that
choice, and explains any deliberate restart. Missing context stays unknown; unresolved choices go
to the user. When a Stage Prompt asks for an independent review before a merge, the supervisor
records each implementing Run's worker and model in an implementation record Comment before the
Story moves on. It then starts the review with a new worker whose model differs from every recorded
one (the same provider is allowed; changing effort or options does not qualify), and asks you
when it cannot tell who wrote the work. An approval holds only for the commit it
names. It skips a Story you hold (`rowbly software-factory hold <story> --reason <text>`)
until you release it. Workers may start and finish independent diff review while CI is pending.
They do not poll a pull request's checks: when remaining work depends on CI, they report the head
commit and pending checks and yield. The supervisor waits with the harness's pull request watch,
or with one bounded `gh pr checks --watch`. A wake or watch exit code only prompts inspection of all
current-head check conclusions; it does not prove every check passed. Cancelled, skipped, neutral
or unknown terminal results need an explicit policy or decision. Checks not yet registered and a
timed-out wait count as waiting, not as a failed check. It runs until you stop it.

After a verified PR merge and worker completion, the supervisor follows the factory skill's
completion workflow on the resource-owning machine. Its cleanup helper defaults to dry run and
requires exact PR/resource ownership, fresh harness inactivity and an exclusive resource lease.
It retains uncertain resources, remote refs and every evidence branch. Repository automatic branch
deletion remains a proposal requiring approval; no setting changes happen automatically. See
[factory completion resources](development/README.md#factory-completion-resources).

A new skill holds
the Rowbly reference (the `skills/rowbly-reference.md` page of this version of Rowbly) in its
`references/` folder, and its `SKILL.md` opens with a short paragraph that sends the agent there.
Every `skills` command works in the current folder and needs no Data Root.

```text
rowbly skills install [path] [--harness <harness>]
rowbly skills create [name] [--harness <harness>] [--description <text>]
rowbly skills list             # the official skills, then the custom skills here
```

- `install` copies a skill folder, with everything in it, to `<harness folder>/<name>`. `path` is a folder that holds `SKILL.md`, or, when no such path exists, the name of an official skill (`rowbly skills install rowbly --harness claude`). Without `path` it shows a menu of the official skills, marking the ones already installed for that harness, or exits 2 with `--no-prompt`. The skill keeps the `name` of its `SKILL.md` frontmatter, else its folder name. A path that is not a skill folder exits 2; a name that is neither a path nor an official skill exits 3; a skill folder that already exists is not changed (exit 4). `--json` prints `{name, description, harnesses, path, official}`.

- `create` writes `<harness folder>/<name>/SKILL.md` and `<harness folder>/<name>/references/rowbly-reference.md`. Without `name` it asks for one, or exits 2 with `--no-prompt`. The name uses lowercase letters, digits and single hyphens, at most 64 characters (exit 2 otherwise). A skill folder that already exists is not changed (exit 4).
- `--harness` picks the agent whose skills folder gets the skill, for `install` and `create`. Without `--description`, `SKILL.md` gets a placeholder description to replace.

  | `--harness` | Skills folder |
  | --- | --- |
  | `generic` (the default), `codex` | `.agents/skills` |
  | `claude` | `.claude/skills` |
  | `gemini` | `.gemini/skills` |
  | `pi` | `.pi/skills` |
  | `cursor` | `.cursor/skills` |

- `list` looks in every folder of the table and shows two sections. **Official skills** lists each official skill with the skill folders that hold it, or `not installed`. **Custom skills** lists every other skill that holds `SKILL.md` and `references/rowbly-reference.md`, with the harnesses that read it. `--json` prints `{official: [{name, description, installed: [{harnesses, path}]}], custom: [{name, description, harnesses, path}]}`, with each `path` relative to the current folder.
- Installed skills and the reference are copies. After upgrading Rowbly, use **Settings → Global → Skills** to update them: an official skill is replaced with the bundled version; a custom skill gets only a fresh `references/rowbly-reference.md`, keeping `SKILL.md` and every other file.

In **Settings → Global → Skills**, the managed folder is the current working folder, even when the
TUI uses a Data Root elsewhere. The section lists bundled names and installed official and custom
skills with their harnesses and relative installation paths. `i` opens installation (a bundled name
or local skill folder); `n` opens creation (name, description and harness). Both forms choose the
harness destination shown above and save with `ctrl+s`. Edit custom instructions outside the TUI.
`u` updates the selected installation after confirmation. `d` asks before deleting its entire folder;
`n`, `esc`, or Enter on the default Cancel button cancels without writing. Only official installations
and custom folders holding both `SKILL.md` and the Rowbly reference can be updated or deleted.
Other skills are excluded. Update and delete reject symbolic links in the selected managed path,
including harness folders, `SKILL.md`, and a custom skill's reference path.
<!-- END skills -->

<!-- BEGIN tui -->
### Git automation

Enable the **Git** Plugin with `rowbly plugins enable git` while the Data Root is inside a Git repository. Otherwise activation reports an error. Git creates `chore: update Rowbly data` commits for saved Rowbly changes, including other Plugins' writes and deletions. Establish a clean Data Root baseline first: edits made by hand to the same affected paths are included. Other files and unrelated staged changes stay untouched; staged changes on an affected path cause a warning instead of a commit. Local State, locks and transaction files are excluded.

```sh
rowbly git show
rowbly git configure --automatic-commits off  # pause locally; keep the Git Plugin enabled
rowbly git configure --automatic-commits on   # resume with saved preferences
rowbly git configure --frequency change
rowbly git configure --frequency interval --interval 600
rowbly git configure --author-name "Rowbly Bot" --author-email "bot@example.com"
rowbly git configure --author-name '' --author-email ''  # restore Git defaults
```

When Git is enabled and loaded, settings (`,`) includes **Git**, with an **Automatic Commits** On/Off choice, frequency, interval in seconds (1–86400, default 300), and author name/email. These are personal preferences in Local State, independent of the shared Plugin enabled setting. Automatic Commits default to On, including when an older saved preference has no on/off setting. The default frequency is after each change. `git show` displays On/Off (the `automaticCommits` boolean in JSON). Blank author fields use Git's effective `user.name` and `user.email` from repository/global configuration (`.gitconfig`).

Saved changes enter a Git queue. The TUI stays usable while commits run; rapid edits may share a commit. Git commits a snapshot of saved files and keeps later edits queued. Command mode waits for due commits, without the reaction's five-second deadline; it does not wait for future interval deadlines.

Interval mode batches changes from the first pending write without postponing the deadline. It commits only when files changed. Timers run while Rowbly is open; CLI commands exit without waiting for a future deadline. Pending paths persist in Git's directory and resume on the next Rowbly run. No daemon runs after exit.

Turning Automatic Commits Off keeps Git enabled and its settings accessible, but prevents Automatic Commits after changes, at interval deadlines and on restart. Saved changes continue to join the pending paths. Frequency, interval and author preferences are preserved; editing them does not turn Automatic Commits back On. Turning On resumes pending work at the selected frequency: change commits immediately, while interval keeps the deadline relative to the first pending change and commits immediately if already due. An already running commit may finish, and later edits remain pending. Disabling the Git Plugin also pauses waiting work until re-enabled.

Git failures warn without undoing a saved Rowbly change; pending work is retried on a later run. Git hooks and commit signing are disabled for these commits. Automatic Commits do not push. Automatic Merge Conflict Resolution, described below, can commit and push independently. See [Git Plugin details](plugins/built-in.md#git).


#### Automatic Merge Conflict Resolution

The **Git** settings have a separate **Automatic Merge Conflict Resolution** section. It defaults to
**Off**, with a 300-second interval (1–86400 seconds). Enable it only when you want Rowbly to fetch,
merge and push the current branch to its configured upstream without prompts or an editor. Configure
that upstream and Git authentication beforehand. Automatic Commits and this feature keep independent
On/Off choices and intervals; changing one preserves the other. Synchronization captures pending
Rowbly changes even when Automatic Commits are Off.

```sh
rowbly git configure --automatic-merge-resolution on --merge-interval 600
rowbly git sync                    # on-demand attempt; requires the preference On
rowbly git show                    # preferences, upstream, active run and last result
rowbly git configure --automatic-merge-resolution off
```

In settings, `e` opens Automatic Commits preferences and `m` opens merge preferences; `ctrl+s` saves
each form. **Run now** is a clickable control with the equivalent `r` key. Both are unavailable while
Off, pending or running. The overview shows the branch, upstream or missing prerequisite, next run,
active phase, last attempt and finish time, result, local commit, repair count and retained evidence
paths. Scroll the settings body for long messages and paths.

Intervals run while Rowbly is open, including outside settings. The next deadline is measured from
the last attempt's completion; changing the interval recalculates it from that saved time (or the
initial scheduling time before the first run). Deadlines and results persist in Git's directory per
Data Root and worktree. Reopening resumes one overdue attempt, then waits a full interval. There is
no daemon while Rowbly is closed. CLI commands wait for admitted/due work before exiting, without
waiting for a future deadline. Turning Off prevents future admission and disables Run now; a run
already admitted may finish, including its push. Disabling Git, switching Data Roots or closing the
TUI stops future scheduling for that host.

Each attempt fetches the configured upstream, prepares a merge separately, reconciles Rowbly data
and configuration, validates the result, commits when needed and normally pushes it. It does not
rebase, create branches or force-push. Independent JSON fields and non-overlapping Markdown hunks
combine. Conflicting values or overlapping hunks use stable content/source ordering, with the exact
base and both alternatives retained as committed evidence under `plugins/git/merge-evidence/` inside
the Data Root. Edit wins over delete, including edited descendants. Distinct concurrent additions
retain both records and their scoped files with source-qualified key remapping; exact identical
additions coalesce. Configuration Cascade levels stay separate. Referenced definitions can be
restored, incompatible field types split and constraints relaxed to retain valid data; original
values and repair decisions remain in the evidence. Evidence is written only for such a decision: a
Board or Story that is new on one side merges as an addition, without evidence. Supported Plugin
formats reconcile their own references and files, including while the Plugin is Off. Unknown,
invalid or unsupported data is kept opaque; an unsafe result stops the attempt rather than
discarding it.

Evidence files are audit history. Rowbly never edits, expires or prunes them. To remove one, first
check that the merge commit that added it is on the upstream, review its decisions and obtain the
user's explicit approval. Record the path, adding commit (`git log --diff-filter=A -- <path>`), review
and approval in the ordinary upstream commit that removes the file. Never rewrite history to
remove it; `git show <commit>:<path>` still reads it afterwards.

Repeated Task numbers or Comment ids within a recognized current-format Story bag stop synchronization
before local publication or push (`CONFLICT`, exit 4), even in BASE, while the owner is Off, or beside
a future shape on another side. Input files, live branch, index and remote remain unchanged. With
the owner on, doctor reports `PLUGIN_DATA_INVALID` (warning) and offers no fix; owner reads and
changes that require the bag fail with `DATA_INTEGRITY` (exit 6). Preserve both records while resolving
their identity by hand. Valid additions from different sources still retain both records with evidence.

Runs coordinate with other Rowbly processes, writes and Automatic Commits. Unrelated staged, dirty
and untracked content is preserved. A conflict outside Rowbly data, unsafe overlap with local edits,
staged Rowbly ambiguity, missing upstream, detached branch or authentication/network failure stops
safely and reports the cause. Fix the cause; the next enabled interval or Run now retries. A rejected
push leaves the valid local merge available and reports **failed**, rather than synchronized; the
next attempt fetches and merges again before retrying a normal push. Interrupted local publication
recovers before Rowbly reads or writes, even while Off; that recovery does not newly push.

`git show --json` includes preferences plus `synchronizationRun`; `git sync --json` returns that run
summary directly. `enabled` and `intervalSeconds` describe the current preference, `requested` means
pending, and `active` contains the running phase. A previous `last` result can coexist with a new
active run. Check `last.kind` (`synchronized`, `failed` or `interrupted`) and its message after pending
and active work end. A local `commit` alone does not prove a push succeeded. Times in these JSON
summaries are epoch milliseconds. See [Git Plugin details](plugins/built-in.md#git).


For explicit `git sync`, a completed failed attempt returns `CONFLICT` (exit 4), with the usual
JSON error on stderr and the safe run summary in `error.details.synchronizationRun`, including any
retained local commit and evidence paths. It prints no success result on stdout. An active or pending
run owned by another process returns its run summary with exit 0; this means pending, not synchronized.
`git show` remains an inspection command and can successfully display a previous failed result.

### Sync with Git

When the Git Plugin is on, the TUI header shows **Sync** (key `S`). It works with
Automatic Commits and Automatic Merge Conflict Resolution either On or Off:

1. Commit pending Rowbly Story, Plugin and configuration additions, edits and deletions before any
   network work. Skip the commit when nothing changed; still fetch and push. Local State, locks,
   transactions, atomic-write temporary files and unrelated files remain excluded.
2. Fetch the current branch's configured upstream.
3. Replay local commits onto that upstream in isolation, reconciling Rowbly data/configuration with
   the same rules and committed conflict evidence as automatic synchronization above. Validate and
   publish the result recoverably. Unrelated staged, working and untracked changes stay intact.
4. Push normally to that same upstream. Never force-push.

While running, the header shows `Sync…` and ignores repeated `S` or clicks. Automatic Commits and
synchronization share one Git worker. A scheduled merge finishes before a waiting manual rebase;
the toast says `Synced with <upstream>` only after that manual run's push succeeds. Inspect progress
and the last result with `rowbly git show`.

Failures show the cause and keep local work, including a capture committed before a failed fetch.
Fix missing upstream with `git push -u origin <branch>` or `git branch --set-upstream-to=origin/<branch>`.
Configure Git author and noninteractive authentication first. Finish any existing merge/rebase before
Sync; commit or unstage already-staged Rowbly files. Resolve non-Rowbly conflicts and dirty files that
upstream would overwrite with Git before retrying. Divergent local merge commits require explicit
`git rebase --rebase-merges` outside Rowbly before retrying; Sync never silently flattens them. Network,
authentication and push rejection errors retain the local result so you can fix the cause and retry.

Sync suppresses hooks and signing, never stashes, and never runs Git under the Data Root lock.
The existing `rowbly git sync` command and scheduled synchronization retain their **merge** behavior
and require Automatic Merge Conflict Resolution On. The header provides manual **rebase** Sync;
no new command or strategy setting is added.


## Interactive mode (TUI)

Run `rowbly` with no command in a terminal to open the full-screen app; global flags such as `--data-root` still apply. Without a terminal `rowbly` prints help and exits 2. On first launch, onboarding opens before the Board or home menu, including for existing users whose completion flags are absent. Outside a local Data Root, the startup picker appears before onboarding when known Data Roots exist; New opens setup. With no known Data Roots, setup can create one after global onboarding. After onboarding, a Board in context (`rowbly use <board>`, or the only Board in the Data Root) opens its Kanban board; otherwise the home menu opens.

The board shows the Board's Stages side by side, in Stage order. Each Stage header shows its name coloured by Stage Category and its number of Stories; Stories are in Rank order and show the Story Key, Priority, name and what Plugins add, such as Assignees and how many Tasks are done (`✓ 1/3`). When the Stages do not fit the terminal width the board scrolls sideways (`‹2` / `3›` count the hidden Stages), and a long Stage scrolls up and down. The mouse wheel over a Stage scrolls its Stories up and down one at a time; in the Stage with the highlighted Story, the highlight moves along to stay on screen. With the mouse, a click selects a Story, a click on the selected Story opens it, and dragging a Story moves it to the place you drop it: onto another Stage, or up or down its own. While you drag, a blue block the size of a Story marks where it will land, under the pointer; the Stories around it move up or down to make room, and the Story lands there when you let go. A right click on a Story selects it and opens a menu beside the pointer with what its keys do: **Open** (`enter`), **Edit** (`e`), **Move to previous Stage** and **Move to next Stage** (`shift+←`/`shift+→`), **Move up** and **Move down** (`shift+↑`/`shift+↓`), **Move to top** and **Move to bottom** (`T`/`B`) and **Delete** (`d`, which asks first). Items that do not apply, such as moving the first Story up, are dimmed. In the menu, `↑`/`↓` (or `j`/`k`) pick an item and `enter` or a click runs it; `esc`, or a click or right click outside the menu, closes it without doing anything else. Moves show at once; if a change cannot be saved, the Story goes back where it was and an error is shown. The board reloads from disk when you come back to it from another screen.

The app watches the open Data Root, so a change made outside it, by a `rowbly` command, another Rowbly or an editor, shows on its own a moment later: the screen on top reloads in place and the board, Board sidebar and Plugin Sidebar follow. A screen under another one reloads when you come back to it. Where you are stays as it was: the open screens, the highlighted Story (when it still exists) and what you have typed in a form. A Story deleted while it is open shows `No Story.` A change to `rowbly.config.json` loads the Plugins again. If the Data Root cannot be watched, a warning says so and the app keeps working; `r` and returning to a screen still reload, and watching starts again once it can.

The header's **Stages / List** switch (or `v` on the board) changes how the board shows its Stories. **Stages** is the view above, and every launch starts with it. **List** shows one line per Story, with its Story Key, name and Stage, grouped under each Stage's name in Stage order. Stories in a section stay in Rank order. A section folds and unfolds, and a long list scrolls up and down. A right click on a Story's line opens the same menu with **Open**, **Edit**, **Move up**, **Move down** (at a section's edge these move the Story to the next Stage, as `shift+↑`/`shift+↓` do) and **Delete**; **Move up** is dimmed on the first Story of the first Stage and **Move down** on the last Story of the last Stage. The choice lasts until you quit and applies to every Board; the highlighted Story stays highlighted when you switch.

A Plugin can add a **Plugin Sidebar** beside the Board sidebar, with a header button that shows and hides it, such as the Epics Plugin's **Epics**. Its first entry, such as **All Epics**, shows every Story; picking another entry shows only the Stories it stands for on the board, in both views, and the header says `filter: Epics: <name>`. The pick applies to every Board, stays while the sidebar is hidden, and lasts until you quit. The button at the bottom, such as **+ New Epic**, creates an entry.

A click in the Board sidebar or a Plugin Sidebar focuses it, and its border lights up like the board's. While a sidebar has focus, `↑`/`↓` (or `j`/`k`) pick the previous / next entry, `n` creates one (a new Board, or what its button creates, such as a new Epic), in the Board sidebar `e` edits the selected Board and `d` deletes it (asking first), and `esc` or a click in the main area gives focus back to the board, where `n` makes a new Story. Drag a sidebar's right edge with the mouse to make it wider or narrower; the board keeps at least 24 columns, and the widths last until you quit. In the Epics sidebar, `e` edits the picked Epic and `d` opens its delete confirmation. A right click on an Epic opens **Edit** (`e`) and **Delete** (`d`) for that Epic without changing the filter. Delete asks first, naming the Epic and how many Stories will be unlinked. **All Epics** has no edit/delete menu. A right click on a Board in the Board sidebar opens a menu with **Edit** (`e`) and **Delete** (`d`) for that Board, without switching to it. **Edit** opens a form with the Board's name and description; its id and key prefix show above the form and cannot be changed. **Delete** asks first, naming the Board; deleting a Board that still has Stories asks again before deleting it with all its Stories and Plugin files, and a deletion that is refused shows an error and deletes nothing. Deleting the Board on screen opens the home screen, which shows the Board in context if one is left.

**Find Stories** (`ctrl+p`, or click the input-like **🔎 Find Stories** control after the Data Root)
opens a finder from main screens. Type at the top to search Story fields, including descriptions,
labels, Custom Fields and dates, plus related Comments, Tasks, Story Specs, linked Board Specs,
Epics, Assignee handles, outgoing Story Links and attachment names from enabled Plugins. Search is
case-insensitive: exact and contiguous matches rank before fuzzy subsequence matches (for example,
`kbd` matches `Keyboard`). Space-separated terms may match different fields. Use `↑`/`↓` then
`enter`, or click a result, to close the finder and open its Story. A Story on the current Board
opens over the board as you left it, with its filter and highlighted card; one on another Board
selects that Board first. `esc` closes without navigating.
Use the mouse wheel over the results to move through longer lists. The finder loads current data
each time it opens; unavailable Plugin content is skipped.

Search covers the current Board by default, independently of Board filters. Turn on **Find Stories
in full Data Root** in Settings › Global › Preferences to search every Board. Results then show
the Board name; opening one selects its Board and opens the Story there. Without a current Board,
the default scope asks you to select one. The preference is off by default and saved as
`storyFinderAllBoards` in `~/.rowblyrc.json` across restarts and Data Roots. The finder stays closed
while a form or modal is open, preserving its text and keys.

The header does not show the Board name (the Boards sidebar marks the open Board); it shows the Board's state, such as its filter, after the Data Root button. It keeps its controls on one line; quiet controls disappear on narrow terminals while their keys stay available in Help. Each Story on the board has three rows in a rounded frame. The list view groups single-line Stories by Stage name, with foldable headings and `No Stories` for empty Stages. When it is longer than the screen, the mouse wheel over it scrolls it three lines at a time, the highlight moves along to stay on screen, and `↑ N more` / `↓ N more` count the lines above and below. The footer shows screen keys on the left, with help, quit and the Rowbly version on the right; framed messages appear at bottom-right. The new Story (`n`), view switch (`v`) and Sync (`S`) hints are omitted from the footer; their keys, header controls and Help entries remain available.

When the TUI starts, Rowbly asks npm for its latest release in the background; commands never do. If a newer release is out, a row above the footer says so, for example `Rowbly 0.12.0 is available, update with npm i -g rowbly` (`Rowbly 0.12.0: npm i -g rowbly` on a narrow terminal), until you quit. Run that command to update. Startup and quitting never wait for the check: offline, a registry error or no answer within 3 seconds shows nothing. When Node sends HTTPS through a proxy from the environment (`NODE_USE_ENV_PROXY=1` or `--use-env-proxy`, with `HTTPS_PROXY`), Rowbly skips the check, because Node cannot cancel a request waiting on that proxy. Set `ROWBLY_NO_UPDATE_CHECK=1` to turn the check off.

`n` on the board, in the list view or in the Stories list opens New Story with **Details**, then the create tabs of enabled Plugins in registry order: **Tasks**, **Specs**, **Links**. Details has core fields, Custom Fields and the fields of Plugins without create tabs (such as Assignees and Epic). Specs holds linked Board Specs and multiple Story Spec drafts. Tasks drafts have Name, Description and Stage; Stage defaults to the first effective Stage. Links drafts choose Blocks or Blocked by and an existing Story on the same Board.

In New Story and Edit Story, focus the Story field and type or press Enter to search by Story Key or name with the same fuzzy ranking as Find Stories. Use ↑/↓ and Enter to choose; this does not save the Story or finish the draft. Escape cancels the search and keeps the prior choice; Ctrl+L clears the query and shows all eligible Stories. No matches change nothing. The current Story is excluded when editing. The separate new-link form uses the same search. Comments are added after creation.

`tab` moves to the next field in the current form; `shift+tab` switches to the next tab (wrapping to Details after the last tab). `←` / `→` switch tabs from a draft list or after the last field; while editing text or a choice they edit that field. `↑` / `↓` and `enter` move between fields, except Enter opens search on a linked Story field. In a Plugin tab with both fields and drafts, `ctrl+g` switches between them. In each draft list, `n` creates a draft, `enter` edits it and `d` removes it. After choosing a linked Story, Tab leaves its field; Enter after an editor's final field keeps the draft. `ctrl+s` (or `ctrl+enter`) saves all tabs from anywhere; Enter after the last Details field also saves. Duplicate Story Spec slugs or invalid links keep the form open, select the Plugin tab, keep its error visible above the scrolling editor and retain every draft. A failed Plugin tab shows its failure and adds no input; the Story can still save. `esc` asks before discarding changed fields or drafts and exits directly when untouched. Story editing uses the same window and navigation, with existing Tasks, Story Specs, linked Board Specs and Links loaded as drafts. Changes across Details and all tabs save together in one operation; cancellation saves none. Unchanged or unavailable Plugin Data stays unchanged. Existing Tasks keep their numbers and creation dates; new Tasks receive new numbers. If another Rowbly operation changes Tasks, Story Spec text or files, Board Spec links or Links after they loaded, saving a changed draft for that data rejects the whole edit and retains all drafts with a conflict error. Close and reopen the editor to load the latest values before applying those edits again. Unchanged tabs do not block unrelated edits.

After you save it, you go back to the Board or list you started from, which reloads and shows the new Story. To open each new Story instead, turn on **Open Story after creation** in the **Preferences** section of the settings (`,`; `enter` turns it on or off). It is off by default, including when you have never set it, and is kept as `openStoryAfterCreation` in `~/.rowblyrc.json`, so it lasts across restarts and applies in every Data Root.

Story, New Story, Edit Story and Settings open in fixed-size screen modals over the Board, up to 120 columns wide. Their headers stay in place while `page up`/`page down` or the mouse wheel scroll the body. Forms, pickers, Help and Plugin screens open in smaller task modals; a task modal that only shows information, such as Help or Factory setup after it ran, has a **Close** button at the bottom that closes it like `esc` or the `✕`; opening a task from Story or Settings keeps that screen underneath and returns to its selection when the task closes. Opening Settings from a Story replaces the Story. In Settings, `esc` returns from the section to its sidebar, then closes Settings. Long sidebar labels wrap; in a short terminal the sidebar scrolls to keep the selected section visible, and `page up`/`page down` or the mouse wheel scroll it while it has focus.

The palette follows `COLORFGBG`: ANSI backgrounds 7 and 15 select the light theme, with dark as the fallback. Rowbly leaves the terminal background visible. Dates in the TUI use local time (for example, `20 Oct 2026, 23:03`); command JSON keeps ISO timestamps.

### Keys on every screen

| Key | Action |
| --- | --- |
| `↑`/`↓` (or `j`/`k`) | move |
| `enter` | select or open; a click on an item in a list does the same |
| `/` | filter a list by typing (on the board and the Stories list: open the filter form); while typing in a Specs list, letter keys enter filter text |
| `esc` | back (or cancel the open form) |
| `D` | switch Data Root (or click the Data Root's name at the left of the header): open another known Data Root (type to search them), create one, `e` edit its label and default, or `d` forget or delete it |
| `,` | settings (or click **Settings** in the header), in a sidebar grouped into Global (Boards, global Stages and Fields, Me, Preferences, Doctor, Plugins, Skills, Experimental Features), the Board in context (Config, Stages, Fields), and a group for each Plugin with settings. `↑`/`↓` pick a section, `tab` (or `enter`) moves between the sidebar and the section |
| `ctrl+p` | find Stories from main screens (or click **🔎 Find Stories** after the Data Root); forms and modals keep their keys |
| `ctrl+b` | hide or show the Board sidebar; it shows again at every launch |
| `\` | show the next Plugin Sidebar, or none (or click its button in the header) |
| `{`/`}` | pick the previous / next entry of the Plugin Sidebar on screen |
| `S` | with the Git Plugin on: Sync with the branch's upstream (or click **Sync** in the header; see [Sync with Git](#sync-with-git)) |
| `?` | the keys of the current screen |
| `q` | quit (from the first screen) |

In a form, `enter`, `tab` and `↓` move to the next field and `shift+tab` and `↑` to the previous one; the focused field scrolls into view, and after the last field `enter` saves. Saving is shown in the modal's key strip, with no separate Save button. `ctrl+enter` saves from any field; terminals without the kitty keyboard protocol send it as a plain `enter`, so `ctrl+s` saves there too. Text fields edit at the caret (`←`/`→`, `home`/`end`). Descriptions are written in place in a multi-line text box: `enter` starts a new line, and `↑`/`↓` leave the box from its first and last lines. `ctrl+f`, or a click on the **[Full screen]** button below the box, opens the text in the full-screen editor, titled with the field's name; `ctrl+s`, `esc`, `ctrl+f` or a click on the `✕` in its border closes it and keeps what you wrote in the form. Closing the editor does not submit the form; press `ctrl+s` again in the form to save it. `space` toggles a yes/no field or a multi-choice option, and `←`/`→` change a choice.

On an open Story or its new/edit form, `ctrl+v`, `alt+v` or `ctrl+alt+v` pastes a clipboard image
through the Plugin that takes pasted images, from any tab or field. The hint shows `ctrl+v paste
image` on macOS/Linux and `alt+v paste image` on Windows when that Plugin is active. Empty bracketed
paste also reads an image; nonempty paste stays text. Image paste pauses under another task,
another screen or the full-screen editor, and during saving. A spinner stays while the clipboard
and Plugin are working; repeated gestures during that work are ignored. The paste hint stays hidden
until that work finishes, including when you open another Story.
An open Story saves through the Plugin immediately. New/edit forms keep images pending until the
Story saves; validation/save failures keep them, and cancellation writes nothing. With no claimant,
the gesture says `Turn on a Plugin that takes pasted images`. An empty clipboard says `No image on
the clipboard`; oversized images and timeouts have their own messages. Unavailable clipboard access
shows environment guidance; on Wayland, install `wl-clipboard` when prompted. Enable the Attachments Plugin to use this flow: `rowbly plugins enable attachments`.
An open Story shows `Attached image-YYYYMMDD-HHMM.png (412 KB)` after saving. Its Attachments tab
lists name, size and date; `n` adds a PNG by file path, `o` opens it, and `d` removes it after
confirmation. A `📎2` badge shows the number on Stories and cards. New Story's Details tab and the
edit form show pending images as `Attachments: 2 images (612 KB)`. Pending images stay in memory,
with a 10 MiB total limit; Escape asks before discarding them.

To copy a screenshot to the clipboard, use **Cmd+Ctrl+Shift+4** on macOS (**Cmd+Shift+4** saves a file),
**Win+Shift+S** on Windows, or your Linux desktop's screenshot-to-clipboard shortcut. The paste
keys above work when the terminal forwards them; on Windows prefer Alt+V if Ctrl+V is handled by
the terminal. Sway/Hyprland and other Wayland desktops may need the `wl-clipboard` package (`wl-paste`).
SSH, headless sessions and unsupported clipboard environments may have no access to the desktop
clipboard. Save or transfer a PNG file and run `rowbly attachments add <KEY> <file>` instead,
or use `n` on the Attachments tab to enter that file path.


The full-screen editor fills the terminal and has two modes. **View** shows the markdown rendered, with headings, emphasis, lists, code and tables; `↑`/`↓` (or `j`/`k`), `page up`/`page down` and the mouse wheel scroll it. **Edit** shows the raw text in a multi-line text box. `tab`, or a click on **View** or **Edit**, switches mode, and `e` also edits from view. A field's text opens in edit mode. A document that the editor saves itself, such as a Spec, opens in view mode: `ctrl+s` saves it, the bar above the text says whether it is saved, and closing with unsaved changes asks before discarding them.

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
| Story › Links (Story Linking Plugin) | `↑`/`↓` select, `enter` or a click opens the linked Story, `/` filter, `n` new link, `d` remove link after confirmation |
| Assignees (Plugin) | `enter` open (then: Edit, Remove), `n` new Assignee |
| Boards | `enter` open the Board detail, `v` view its board without changing the context, `s` Stages, `f` Custom Fields, `n` new Board, `e` edit (the id and key prefix cannot be changed), `d` delete. A click selects a Board; a right click selects it and opens a menu with **Open**, **Edit** and **Delete**. In Settings, click the section first to focus it |
| Epics (Epics Plugin) | `enter` open the Epic, `n` new Epic, `a` open / closed / all, `e` edit, `c` close or reopen, `d` delete (asks first, naming the Epic and how many Stories it unlinks). A right click on an Epic highlights it and opens a menu with **Open**, **Edit**, **Close** or **Reopen** and **Delete**; an unavailable Epic has no menu |
| Board detail (and Config) | `v` view its board, `o` its Stories list (both without changing the context), `s` Stages, `f` Custom Fields |
| Stages | `n` new Stage, `e` edit, `shift+↑`/`shift+↓` move up / down, `T`/`B` move first / last (just after Backlog / before Done), `d` remove (asks where to move Stories still in it). Backlog and Done are marked fixed and ignore `e`, `d` and moves |
| Fields | `n` new Custom Field, `e` edit, `d` remove |
| Me | `enter` edit the highlighted level (Global or This Data Root); in the form, `ctrl+s` saves the handle (empty clears that level) |
| Context | `enter` switch Board (or create the global Data Root while it does not exist), `c` clear the current Board |
| Doctor | `f` fix, `r` check again |
| Skills (in Settings) | `i` install bundled or local skill, `n` new custom skill, `u` update, `d` delete (both ask first); `↑`/`↓` select, `/` filter |
| Plugins | `enter` turn the Plugin on or off |
| Experimental Features | `enter` turn the selected feature on or off; no toggle is offered when none are available |
| Stage Prompts (Software Factory Plugin) | `space` turn the highlighted Stage's Stage Prompt on or off at the shown level (as `prompt enable` does, a new Board file starts from the global file), `enter` read it, `e` edit it (`ctrl+s` saves), `d` remove the shown level's entry and file |

Long Story names and Plugin badges truncate to keep each Story on one line in the list view. Selection uses the same bar and fill in lists, forms and Plugin tabs.

Plugins that are on can add home menu entries, screens, fields to the Story form and filter, tabs and rows to the Story screen (the Story shows, and takes its keys, before its Plugin rows and badges have loaded), badges to Stories on the board and in the board's list view, and sections to the Board detail. A Plugin's **Actions** are keys that show in the footer, the help (`?`) and as buttons in the header wherever the Board or Story they act on is in focus. While an Action that acts on nothing in particular runs, such as **Sync**, its label in the header ends in `…` and its key does nothing.
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

With the corresponding Plugins enabled, `stories create` also accepts repeatable create options:

| Option | Effect |
| --- | --- |
| `--task <name>` | Create name-only Tasks in flag order, numbered 1, 2, …, in the first effective Stage. Names are literal: commas and whitespace are preserved. |
| `--spec <slug>` | Link an existing Board Spec (unchanged; repeatable, comma-separated). |
| `--story-spec <slug>=<file>` | Create a Story Spec from a UTF-8 Markdown file; repeatable for several Specs with unique slugs. `-` reads stdin, at most once including `--description-file -`. Title is the first `#` heading or the slug. |
| `--blocks <key>` | Link an existing same-Board Story that this new Story blocks. |
| `--blocked-by <key>` | Link an existing same-Board Story that blocks this new Story. |

All create options join one `stories.create` operation. Invalid Plugin input saves nothing, including Spec files and the existing blockers' bags. Files and stdin are read before the operation starts. These options do not change `stories edit`.

In Settings, choose **Stages** or **Fields** under **Global** to edit the defaults for Boards without their own list. Choose the matching section under **Board: <name>** to edit that Board's list. A Board without its own list uses the global list (or built-in defaults); its first edit copies that list to the Board. A Board with its own list no longer follows changes to global defaults. These sections have no scope tabs or scope-switching key. Opened outside Settings, Stages and Fields use the Board in context, or global defaults without a Board.

In Settings, choose **Stage Prompts** under **Global** or **Board: <name>**. The selected section fixes the scope for reading and writing; there are no scope tabs or `l` shortcut. Without a Board, only Global is available. Board Stages without their own Stage Prompt use the global one. Editing or toggling creates a Board entry for that Stage; removing the Board entry and file restores the global Stage Prompt. Turning a Board entry off keeps it and prevents the global prompt from applying.

### Onboarding

Global onboarding sets your existing **Me** handle in the Home Config and registers existing Data
Roots by their Data Root folder path, with an optional label and default. It never creates a Data Root
and preserves local Me. Invalid or missing registration paths create nothing. Without an open Data
Root, Continue returns to the startup picker when roots have been registered; with none, it opens setup.
An explicit missing `--data-root` still fails before onboarding; a missing registered default is shown in the startup picker.

Data Root onboarding has six step tabs: **Usage**, **Board**, **Plugins**, **Agent skills**,
**Stage Prompts** and **Summary**. With exactly one Board, the Board tab is hidden: onboarding puts
that Board in context and marks the step done. Adding or removing a Board recomputes this choice.
Click any tab to open its step, or use **Back** (`ctrl+←`) and **Next** (`ctrl+→`). **Next** never
requires completion and finishes onboarding on Summary. Text fields keep their keys; the Buttons
still work. **Skip onboarding** (`ctrl+k`) saves completion. Results stay inline, without Modals,
and completed tabs have a `✓`. Changes are saved as they happen.

**Usage** asks how you will use this Data Root: **Plain Kanban**, **Software Factory**, or **Both**.
Plain Kanban turns Software Factory off and hides Stage Prompts; the other choices turn it on.
Plugins is shown in every mode. Reopening uses Software Factory's on/off setting, without saving
the usage answer. **Board** chooses among several Boards or creates the first. **Plugins** offers
optional Plugins; unchecked Plugins turn off with their Plugin Data kept.

**Agent skills** directly offers official skills, without an AI usage question. Choose a skill,
destination folder and harness to install it through `rowbly skills install`'s service; existing
folders are never overwritten. Installed skills have **(installed)** markers and their folders,
and remain selectable for another folder or harness. **Continue without installing more skills**
goes to the next step. Installing a skill or continuing marks this step done. Custom skill commands
are also explained.

**Stage Prompts** explains how the `rowbly-factory` skill supervises Stories in Stages whose Stage
Prompt is on. Choose **Populate Stage Prompts with default prompts** for Rowbly's pre-built
instructions (In Progress and In Review on, TODO off), **Populate Stage Prompts with minimal prompts**
for placeholders to edit later (all off), or **Edit Stage Prompts** for the inline editor. `esc`
returns from editing to these choices. Populating runs only when chosen, adds missing factory
Stages and Stage Prompts, and lists added, kept and skipped items below the choices. Existing
Stages, Stage Prompts and files are kept, including when you subsequently choose the other option.
Errors leave the choices available to retry. Edit here or in **Settings › Stage Prompts** at any time.

**Summary** lists this visit's usage choice (or Software Factory on/off on reopening), Board in
context, enabled Plugins, installed skills and their folders, and Stage Prompts outcome when
Software Factory is on. Unvisited steps read **not changed in this visit**. **Finish onboarding**
saves completion.

Finished steps are saved immediately in the committed `rowbly.config.json` as `onboardingSteps`:
`mode`, `board`, `plugins`, `skills`, `stage-prompts`. Stage Prompts is marked done after successful
population or leaving with Next. Reopening shows marks and starts at the first incomplete step.
Legacy `ai` counts as `skills` done and `factory-setup` as `stage-prompts` done; their original ids
and unknown ids are kept on save. Saving progress never clears completion.

Completing or pressing **ctrl+k** to skip saves `onboardingComplete: true` in `~/.rowblyrc.json` for
global onboarding, or in the Data Root's committed `rowbly.config.json` for Data Root onboarding.
Absent or false means incomplete. Data Root completion is shared: once that configuration reaches
other people, onboarding stays suppressed for them too. Switching to an incomplete Data Root opens
its onboarding. Reopen either flow with **Settings › Onboarding**: it closes Settings and opens the full-screen
flow, which ends where it does at startup. Revisiting leaves the flag set and
existing records intact. Errors keep the current step available for retry. In registration and skill
installation forms, **esc** returns to the preceding choice. Demo mode bypasses onboarding.

Onboarding fills the terminal above the footer, without the header or sidebars. Until it ends, the
keys for that frame do nothing: **ctrl+b**, **\\**, **{**/**}**, **[**/**]**, Board numbers, **ctrl+p**,
**n** for a new Story, **,** for Settings, **D** and Plugin Actions. The footer, **?** help and **q**
still work, and finishing or skipping brings the frame back.
