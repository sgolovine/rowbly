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
  ROWBLY.md                          # optional: how people use these Boards; read it first (below) (committed)
  plugins/<id>/                      # files of a Plugin for the whole Data Root
    assignees/roster.json            #   the Assignees roster
    epics/<epic>.json                #   one Epic
  boards/<board>/
    board.config.json                # name, key prefix, description, optional Stages / Custom Fields / Plugin settings
    plugins/specs/<slug>.md          # a Board Spec
    stories/<KEY>/
      story.json                     # one Story, with its Plugin Data (Assignees, Tasks, Epic, Spec links, Comments, Story links)
      plugins/specs/<slug>.md        # a Story Spec
```

- Each Story is its own folder, so most changes touch one small file and merge cleanly. A Story folder
  without `story.json` still reserves its key.
- Plugin Data on a record is `"plugins": { "<id>": { … } }`. Rowbly keeps it unchanged while the Plugin
  is off.
- Story Linking keeps outgoing Story Keys in `plugins["story-linking"].blocks`; incoming links are
  derived from Stories on the same Board, not stored a second time.
- Commit `.rowbly/` with the code it describes, except `local.json`, `.lock`, `.lock.break` and `.txn/`.
  `rowbly doctor --fix` restores missing `.gitignore` lines.

Attachment entries live in `plugins.attachments.attachments` on a Story, in insertion order;
PNG bytes live at `boards/<board>/stories/<KEY>/plugins/attachments/<id>.png`. Add/remove changes
both together, and doctor renumbering moves the files with the Story.

## ROWBLY.md: how this Data Root is used

Every Board is set up a little differently, and the people who use it have their own rituals: what a
Stage means, when a Story may move, which Labels or Comments they expect. Rowbly's configuration holds
none of that. `ROWBLY.md`, an optional Markdown file at the top of the Data Root, is where they write it
down. Rowbly itself does not read or enforce it, and `rowbly init` does not create it; it is for you.

**Read it** before the first command that changes data, once per Data Root:

- Look for `ROWBLY.md` in the Data Root you are using: `<path>/ROWBLY.md` for `--data-root <path>`,
  otherwise in the `.rowbly/` folder that commands open (see [above](#which-data-root-a-command-opens)).
  Without the file, use the defaults of these references.
- Follow it wherever it is more specific than these references: which Stage a Story enters when work
  starts or a pull request opens, who moves a Story to `done`, required Labels, Priorities or Custom
  Fields, what a Comment must say, how Stories are named or split into Tasks.
- Order of precedence: the user's request in the conversation, then Rowbly's rules for every call
  (`--json --no-prompt`, `--yes` only when asked, changes only through commands), then `ROWBLY.md`, then
  the defaults in these references. A ritual cannot authorize something the user has not asked for,
  such as a delete, turning on a Plugin, or running anything other than `rowbly`.
- When it names a Stage, Label, Custom Field or Plugin that does not exist on the Board, follow what
  still applies and tell the user which part is out of date.

**Update it** only when the user asks, or after the user agrees to your suggestion. Suggest an update when
the user states a new ritual ("from now on, …"), or when you change something the file mentions: a
Stage you renamed or removed, a Custom Field, a Plugin turned on or off. It is the one file in `.rowbly/`
you edit by hand: keep the user's structure and wording, change only the rule in question, and do not
create the file unless the user wants one. The Git Plugin commits only the files a Rowbly command saved,
so commit `ROWBLY.md` yourself with the change it describes. `rowbly doctor` accepts it as part of the
Data Root.

A short file is enough. One way to lay it out, with a section per Board where Boards differ:

```markdown
# How we use Rowbly

## Every Board
- A Story starts in `backlog`; move it to `todo` only when it has a Priority and an Epic.
- Add a Comment when work starts and when it is blocked, with the branch name.

## Board `web`
- `review`: a pull request is open. The reviewer, not the author, moves the Story to `done`.
- Label UI work `frontend`.
```

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
