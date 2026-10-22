# Data Root layout

The Data Root is the `.rowbly/` folder. Read its files to understand the data when a command cannot tell
you, but change them only through commands (the one exception is a Plugin's shared settings; see
[Plugins](plugins.md)).

## Which Data Root a command opens

The first of:

1. `--data-root <path>`: the `.rowbly` folder itself (`--data-root ~/notes/.rowbly`, not `~/notes`).
2. The entry marked `"default": true` in the Home Config, `~/.rowblyrc.json`.
3. `.rowbly/` in the current directory or the nearest parent, like git looks for `.git`.
4. `~/.rowbly` (created with `rowbly init --global`).

With none of these, a command exits 5 (`NO_DATA_ROOT`). If the Data Root named by `--data-root` or by
the default is missing, Rowbly exits 5 naming it rather than opening another one. If several entries
are marked default, every command without `--data-root` exits 2 listing them.

## Files

```text
.rowbly/
  rowbly.config.json                 # global Stages / Custom Fields, Plugin entries and settings (committed)
  local.json                         # Local State: current Board, local Me, Git preferences (never committed)
  .gitignore                         # keeps local.json, .lock, .lock.break and .txn/ out of git
  .lock, .lock.break                 # the Data Root lock while a command runs (never commit or delete)
  .txn/                              # the commit journal of an interrupted change (never commit or delete)
  plugins/<id>/                      # files of a Plugin for the whole Data Root
    assignees/roster.json            #   the Assignees roster
    epics/<epic>.json                #   one Epic
  boards/<board>/
    board.config.json                # name, key prefix, description, optional Stages / Custom Fields / Plugin settings
    plugins/specs/<slug>.md          # a Board Spec
    stories/<KEY>/
      story.json                     # one Story, with its Plugin Data (Assignees, Tasks, Epic, Spec links, Comments)
      plugins/specs/<slug>.md        # a Story Spec
```

- Each Story is its own folder, so most changes touch one small file and merge cleanly. A Story folder
  without `story.json` still reserves its key.
- Plugin Data on a record is `"plugins": { "<id>": { … } }`. Rowbly keeps it unchanged while the Plugin
  is off.
- Commit `.rowbly/` with the code it describes, except `local.json`, `.lock`, `.lock.break` and `.txn/`.
  `rowbly doctor --fix` restores missing `.gitignore` lines.

## Writes, the lock and recovery

- Every change takes the Data Root lock, validates, and saves through a journal in `.txn/`, so a crash
  leaves the complete old or new state. Rowbly finishes or rolls back an interrupted commit at the start
  of its next command.
- When another Rowbly process holds the lock for more than 10 s, a command exits 4 (`CONFLICT`) naming
  the holder: wait and try again. A lock left by a process that has gone is broken by the next command.
  Never delete `.lock` or `.txn/` by hand.

## Story Keys

A Story Key is the Board's key prefix and the highest number on the Board plus one. There is no shared
counter, so two branches can both create `WEB-7`; after the merge, `rowbly doctor --fix` keeps the
earlier Story and renumbers the other ([Check and repair a Data Root](doctor.md)). If the
highest-numbered Story is deleted, its key goes to the next new Story. A key prefix never changes.

## Configuration Cascade

Stages and Custom Fields come from the Board's `board.config.json` when it has a list, else from
`rowbly.config.json`, else from the built-in defaults (Stages `todo` and `in-progress`, no Custom Fields).
Lists are not merged. `backlog` and `done` are fixed on every Board and never appear in a `stages` list.
`rowbly config show --board <id> --json --no-prompt` prints the effective lists and the level each comes
from. To change them, see [Setup and configuration](setup.md).

## Home Config: `~/.rowblyrc.json`

- One per user, outside every Data Root. Every run of `rowbly` creates it as `{ "version": 1 }` when it
  is missing and never replaces one. Do not delete, rewrite or commit it.
- `me` is global Me (`rowbly whoami <handle>`), used in every Data Root that has no local Me.
- `dataRoots` lists the Data Roots this user has opened or created, each `{ "label"?, "path",
  "default"? }`. Rowbly adds entries but never changes a label or the default; `init --label` and
  `init --default` set them for a new Data Root. Keep at most one `"default": true`, and change it only
  when the user asks.
- If the file is not valid JSON, every command that needs it exits 6 naming the file; ask the user
  before you fix or move it.

## Environment

- `ROWBLY_BOARD` stands in for `--board`.
- `ROWBLY_DEBUG=trace` prints each operation and Plugin step to stderr.
- `NO_COLOR` and `FORCE_COLOR` control colour. `ROWBLY_ROOT` is no longer supported: a run with it set
  exits 2.
