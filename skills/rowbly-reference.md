# Rowbly: a reference for agents

This page is for an agent that runs a skill which mentions Rowbly ("work on every Story in progress",
"when a Story moves to done, …", "create a Story for each finding"). It is not a skill itself. Copy it into
your skill's `references/` folder and point at it from your `SKILL.md`, for example:

> When this skill mentions Rowbly, a Story, a Board or a Stage, read `references/rowbly-reference.md`
> before running any `rowbly` command.

Rowbly is a Kanban tracker that stores its data as JSON and Markdown files in a `.rowbly/` folder (the
**Data Root**), usually committed with the code. `rowbly <noun> <verb> …` runs one command and exits.
Bare `rowbly` opens a full-screen TUI for people; **agents never run it**.

## 1. Rules for every call

- Add `--json --no-prompt` to every command. `--json` gives parseable stdout; `--no-prompt` makes a
  missing value exit 2 instead of waiting for input forever.
- Add `--yes` only to a delete the user asked for. Never pass `--edit` (it opens an editor and waits).
- Pass `--board <id>` when a command needs a Board and the Data Root has several. A Story Key (`WEB-42`)
  or Task id (`WEB-42.1`) never needs `--board`: its prefix names the Board.
- Change data only through commands. Never edit files under `.rowbly/` by hand (one exception: a
  Plugin's settings beside its `enabled` key in `rowbly.config.json`).
- Do not retry a failed command unchanged. Exits 2, 3 and 4 are deterministic; read `error.details`
  and `hint`, then change the input.
- Check `rowbly --version` first. In the Rowbly source repository without a global install, use
  `pnpm dev <args>` instead of `rowbly <args>`.

Repeatable flags (`--label`, `--stage`, `--priority`, `--field key=value`, `--assignee`, `--spec`) may be
repeated or comma-separated. Long text takes `--description <text>` or `--description-file <path>`;
`--description-file -` reads stdin. Every command has `--help`.

## 2. Output and errors

Success prints JSON on stdout: an array for `list`, one record for `create`, `show`, `edit`, `move`
and `rank`, `{ "deleted": "<id>" }` for `delete`. Failure prints nothing on stdout and one line on
stderr:

```json
{"error":{"code":"VALIDATION","message":"unknown Stage \"nope\"","details":{"validStages":["backlog","todo","in-progress","done"]},"hint":"valid Stages: backlog, todo, in-progress, done"}}
```

| Exit | `error.code` | Meaning | Do |
| --- | --- | --- | --- |
| 0 | — | Success | — |
| 1 | `INTERNAL` | Bug, unreadable file or a Plugin that failed mid-change; nothing was saved | Report it; do not loop |
| 2 | `USAGE` | Bad flags, missing value, no Board in context, no `--yes`, command of a Plugin that is off | Fix the command line; the `hint` says how |
| 2 | `VALIDATION` | Unknown Stage, Assignee or Custom Field, bad Label or date | Use a value from `details` |
| 3 | `NOT_FOUND` | Unknown Board, Story, Task, Comment, Epic or Spec | List the records; check the id |
| 4 | `CONFLICT` | Id or prefix exists, deletion refused, Plugin refused, lock busy 10 s | Read the message; do not force without the user |
| 5 | `NO_DATA_ROOT` | No `.rowbly/` found (`details.path`) | Create one only if the user wants it |
| 6 | `DATA_INTEGRITY` | A file is invalid or has git conflict markers (`details.path`) | `rowbly doctor --fix --json --no-prompt`, see §9 |

Warnings go to stderr even on success.

## 3. Words Rowbly uses

Use these in commands, commit messages and replies.

| Term | Meaning | Not |
| --- | --- | --- |
| Data Root | The `.rowbly/` folder | project, workspace, database |
| Board | A Kanban board with a key prefix, id `web`, prefix `WEB` | project |
| Story | The unit of work, keyed `WEB-42` | issue, ticket, card |
| Stage | A step in a Board's workflow; `backlog` is always first and `done` always last | status, column |
| Stage Category | `backlog`, `board` or `done`; every Stage has one | — |
| Rank | A Story's position inside its Stage | order |
| Priority / Label | `P0` (most urgent) to `P4` / a lower-kebab-case tag | severity / tag |
| Custom Field | A typed per-Board field, set with `--field key=value` | — |
| Me | The handle the user works as (`rowbly whoami`) | user |
| Task | A smaller item inside a Story, `WEB-42.1` (Tasks Plugin) | subtask |
| Assignee | A person in the roster (Assignees Plugin) | owner |
| Epic | A group of Stories from any Boards (Epics Plugin) | — |
| Spec | A Markdown document of a Story or a Board (Specs Plugin) | — |
| Comment | A note on a Story (Comments Plugin) | — |

## 4. Where a command looks

- **Data Root**: the first of `--data-root <path>` (the `.rowbly` folder itself, not the code folder),
  the entry marked `"default": true` in `~/.rowblyrc.json`, `.rowbly/` in the current directory or
  the nearest parent, `~/.rowbly`. A default in `~/.rowblyrc.json` wins over the current directory, so
  pass `--data-root` when the user names a Data Root.
- **Board**: the first of `--board <id>`, `ROWBLY_BOARD`, the current Board set with `rowbly use <id>`,
  the only Board. Otherwise exit 2 `board required`.

```sh
rowbly use --json --no-prompt            # {"board": {"id": "web", "source": "local"}}; exit 5 if there is no Data Root
rowbly boards list --json --no-prompt    # [{id, name, keyPrefix, …}]
```

Run one of these before a series of changes and confirm it is the Data Root and Board you expect.

## 5. Stages: read them, never assume them

Stages are configured per Board. Only `backlog` and `done` exist everywhere; the defaults between them
are `todo` and `in-progress`, but a Board may have `doing`, `review` or anything else.

```sh
rowbly config show --board web --json --no-prompt   # .stages[] {key, name, category}, .customFields[]
```

When a skill says "in progress", "in_progress" or "doing", match a Stage by **key or name** on the Board
in question; if none matches, use the last Stage of category `board`. When a skill says "open", use
`--open` (every Stage not in the `done` category). Read Stages once per Board and reuse them.

## 6. Stories

```sh
# Find
rowbly stories list --board web --json --no-prompt                        # Stage order, then Rank
rowbly stories list --board web --stage in-progress --json --no-prompt    # one Stage
rowbly stories list --board web --category board --json --no-prompt       # backlog | board | done
rowbly stories list --board web --open --sort priority --json --no-prompt # --sort rank|priority|created|updated|due
rowbly stories list --all-boards --label auth --search login --json --no-prompt
rowbly stories show WEB-42 --json --no-prompt                             # full record with Plugin Data

# Create (goes to the bottom of backlog unless --stage is given; read `key` from the output)
rowbly stories create --board web --name "Login page" \
  --description "Users sign in with email." --priority P1 --label auth,frontend \
  --due 2026-11-30 --field area=frontend --json --no-prompt

# Edit (--label replaces the whole list; --add-/--remove- change one value)
rowbly stories edit WEB-42 --name "Sign-in page" --add-label in-review --priority P0 --json --no-prompt
rowbly stories edit WEB-42 --no-priority --no-due --remove-label in-review --unset-field area --json --no-prompt
rowbly stories edit WEB-42 --description-file ./notes.md --json --no-prompt   # replaces the description

# Move between Stages, rank within a Stage, delete
rowbly stories move WEB-42 in-progress --json --no-prompt       # bottom of that Stage; --top for the top
rowbly stories rank WEB-42 --before WEB-40 --json --no-prompt   # or --after <KEY>, --top, --bottom
rowbly stories delete WEB-42 --yes --json --no-prompt           # only when the user asks
```

A Story's JSON: `key`, `boardId`, `name`, `description` (Markdown), `stage`, `rank`, `priority` (`"P1"` or
`null`), `labels`, `dueDate`, `customFields`, `createdBy`, `createdAt`, `updatedAt`, and `plugins`
with one entry per Plugin that has data (`plugins.tasks.tasks`, `plugins.assignees.assignees`,
`plugins.epics.epic`, `plugins.specs.specs`, `plugins.comments.comments`).

Rules: Priority is `P0`–`P4`; a Label is lower-kebab-case (`auth`, never `Auth`); `--due` is
`YYYY-MM-DD`; required Custom Fields need a `--field`; a Story never moves to another Board. Story Keys
are case-insensitive.

## 7. Working on a Story

The Board is how the user sees progress, so keep the Stage current without being asked:

1. Read the request: `stories show`, plus `tasks list`, `specs list --story`, `comments list` for the
   Plugins that are on.
2. Before changing any code, move the Story to the in-progress Stage (§5).
3. Record progress, blockers and decisions as Comments (§8), and move Tasks to `done` as they finish.
4. When the work is complete, move the Story to `done` as the last step. Finishing every Task does not
   move the Story.
5. Mention the Key in branch names and commit messages (`WEB-42: add login form`), and commit `.rowbly/`
   with the code unless the Git Plugin does it.

## 8. Plugins

Six Built-in Plugins ship with Rowbly. Each is **off** until the Data Root turns it on, for everyone
who shares the Data Root. While off, its command is unknown (exit 2, hint `Plugin "tasks" is off`) and
its options on core commands are unknown options.

```sh
rowbly plugins list --json --no-prompt            # [{id, name, enabled, loaded, …}]
rowbly plugins enable tasks --json --no-prompt    # changes shared configuration: say that you did
rowbly plugins disable tasks --json --no-prompt   # keeps its data
```

Turn a Plugin on only when the request needs it. Ask the user first for `assignees` and `git`.

**Tasks** (`tasks`): smaller items inside a Story, id `WEB-42.1`, using the Board's Stages.

```sh
rowbly tasks create WEB-42 --name "Build the form" --json --no-prompt    # --stage, --description
rowbly tasks list WEB-42 --json --no-prompt                              # creation order, with ids
rowbly tasks show WEB-42.1 --json --no-prompt
rowbly tasks edit WEB-42.1 --name "Build the sign-in form" --json --no-prompt
rowbly tasks move WEB-42.1 done --json --no-prompt
rowbly tasks delete WEB-42.1 --yes --json --no-prompt
```

**Comments** (`comments`): notes on a Story, oldest first; the author is Me.

```sh
rowbly comments add WEB-42 --body "Blocked on the token endpoint." --json --no-prompt   # or --body-file <path|->
rowbly comments list WEB-42 --json --no-prompt                                         # [{id, author, body, createdAt, updatedAt}]
rowbly comments edit WEB-42 <id> --body "Unblocked." --json --no-prompt
rowbly comments delete WEB-42 <id> --yes --json --no-prompt
```

**Assignees** (`assignees`): a roster of handles; `me` means Me and needs Me set.

```sh
rowbly assignees list --json --no-prompt                                 # valid handles
rowbly assignees add sam --name "Sam Lee" --email sam@example.com --json --no-prompt
rowbly stories list --board web --assignee me --json --no-prompt
rowbly stories edit WEB-42 --add-assignee sam --json --no-prompt         # --assignee replaces, --remove-assignee drops
```

**Epics** (`epics`): group Stories from any Boards; a Story has at most one Epic.

```sh
rowbly epics list --json --no-prompt                                     # open Epics; --closed, --all
rowbly epics create auth --name "Authentication" --json --no-prompt
rowbly epics show auth --json --no-prompt                                # its Stories and progress
rowbly stories edit WEB-42 --epic auth --json --no-prompt                # --no-epic unlinks
rowbly stories list --all-boards --epic auth --json --no-prompt
rowbly epics close auth --json --no-prompt                               # epics reopen, epics edit, epics delete
```

**Specs** (`specs`): Markdown documents. A Story Spec belongs to one Story (`--story`); a Board Spec
belongs to a Board (`--board`) and Stories link to it. The default Story Spec slug is `spec`.

```sh
rowbly specs list --story WEB-42 --json --no-prompt                      # [{slug, title, text}]
rowbly specs show --story WEB-42 --json --no-prompt                      # the Story Spec `spec`
rowbly specs show design --story WEB-42 --json --no-prompt               # another slug
rowbly specs create --story WEB-42 --title "Login page" --file ./spec.md --json --no-prompt   # or --text, --file -
rowbly specs edit design --story WEB-42 --file ./design.md --json --no-prompt
rowbly specs list --board web --json --no-prompt                         # Board Specs
rowbly stories edit WEB-42 --add-spec auth-flow --json --no-prompt       # --spec replaces, --remove-spec unlinks
```

Always name a Story Spec with `--story WEB-42`; `specs show web-42` looks for a Board Spec.

**Git** (`git`): commits saved Rowbly changes automatically (`chore: update Rowbly data`). Enable it
only when the user asks. `rowbly git show` and `rowbly git configure --frequency change|interval
--interval <seconds>` manage personal preferences. When it is on, do not also commit `.rowbly/` yourself.
In the TUI, `S` (**Sync**) commits pending Rowbly changes, rebases onto the branch's upstream and pushes,
never forced; there is no Sync command. On a failed Sync, keep local commits and never force-push.

## 9. Setup and repair

```sh
rowbly init --board web --board-name Website --prefix WEB --json --no-prompt   # from the repository root; exit 4 if one exists
rowbly boards create api --name "API" --prefix API --json --no-prompt          # the prefix can never change
rowbly whoami --json --no-prompt                  # {"me": "sam" | null, …}; set with `rowbly whoami <handle>` only if the user asks
rowbly stages add review --name "Review" --after in-progress --board web --level board --json --no-prompt
rowbly fields add estimate --name "Estimate" --type number --board web --json --no-prompt   # text|number|boolean|date|url|select|multiselect
rowbly doctor --json --no-prompt                  # {findings, fixed, summary}; exit 6 while errors remain
rowbly doctor --fix --json --no-prompt            # safe repairs only; never deletes a Story
```

Run `doctor` after a git merge, pull or rebase that touched `.rowbly/`, after any exit 6, and after a
hand edit. Stages and Custom Fields live at two levels, `global` (`rowbly.config.json`) and `board`;
a Board uses the most specific list that exists and the lists are not merged, so pass `--level`
explicitly. Never commit `.rowbly/local.json`, `.lock`, `.lock.break` or `.txn/`; the `.gitignore`
that `init` writes excludes them. Leave `~/.rowblyrc.json` alone.

## 10. A skill pattern

A skill that acts on every Story in progress on the current Board:

```sh
set -e
BOARD=$(rowbly use --json --no-prompt | jq -r '.board.id')
STAGE=$(rowbly config show --board "$BOARD" --json --no-prompt \
  | jq -r '[.stages[] | select(.category == "board")] | (map(select(.key | test("progress|doing"))) | first) // last | .key')
rowbly stories list --board "$BOARD" --stage "$STAGE" --json --no-prompt | jq -r '.[].key' | while read -r KEY; do
  rowbly stories show "$KEY" --json --no-prompt      # read it, do the work, then:
  rowbly comments add "$KEY" --body "…" --json --no-prompt   # if the Comments Plugin is on
  rowbly stories move "$KEY" done --json --no-prompt
done
```

## Common mistakes

- Omitting `--no-prompt`: a missing value can wait for input forever in a shell with a terminal.
- Hard-coding `in-progress` or `todo`: read the Board's Stages (§5).
- `--label x`, `--assignee x` or `--spec x` on `edit` to add one value: they replace the list. Use
  `--add-label`, `--add-assignee`, `--add-spec`.
- Title Case or spaced Labels: a Label is lower-kebab-case or the command exits 2.
- Guessing the next Story Key: read `key` from each `create` output.
- `--data-root ~/code/app`: point at the `.rowbly` folder, `~/code/app/.rowbly`.
- Parsing table output: it changes with terminal width and colour. Parse `--json` only.
- Leaving a Story where it was after working on it: move it to in progress when work starts and to
  `done` when it is complete.
