---
name: rowbly-stories
description: "Use when tracking work in a Rowbly Data Root: finding, creating,
  editing, moving, ranking or deleting Stories (keys like WEB-42) and their
  Tasks (WEB-42.1), filtering stories list, setting Assignees, Priority, Labels,
  due dates and Custom Field values, or picking up and finishing a Story as an
  agent. Not for Board, Stage or Custom Field configuration (rowbly-setup)."
metadata:
  purpose: >-
    Show an agent how to do day-to-day work tracking with the Rowbly CLI:
    find and read Stories, create Stories and Tasks with valid values, and
    move them through a Board's Stages as work progresses.
  type: sub-skill
  library: rowbly
  library_version: 0.1.0
requires:
  - rowbly-cli
sources:
  - README.md
  - docs/agents/CONTEXT.md
  - src/commands/stories.ts
  - src/commands/tasks.ts
  - src/services/stories.ts
  - src/services/tasks.ts
---

# Track work with Stories and Tasks

Read `rowbly-cli` first. Every command below takes `--json --no-prompt`, and a delete also needs `--yes`.

## 1. Learn the Board before you change it

Stage keys, Custom Fields and Assignees differ per Board. Read them once:

```sh
rowbly boards list --json --no-prompt               # Board ids and key prefixes
rowbly config show --board web --json --no-prompt   # .stages[] {key,name,category}, .customFields[]
rowbly assignees list --json --no-prompt            # valid handles
rowbly whoami --json --no-prompt                    # {"me": "sam" | null}
```

Pick Stages by **category**, not by name. The Stage to start work is the first Stage whose category is
`in_progress`, and the Stage to finish is the first whose category is `done`. A Board's Stages might be
`backlog`, `doing`, `shipped`, with no `in-progress` or `done` key at all.

## 2. Find and read Stories

```sh
rowbly stories list --board web --open --json --no-prompt                      # not in a done Stage
rowbly stories list --board web --assignee me --sort priority --json --no-prompt
rowbly stories list --all-boards --label auth --search login --json --no-prompt
rowbly stories show WEB-42 --json --no-prompt                                  # full Story with its Tasks
```

- Filters: `--stage <key>`, `--category todo|in_progress|done`, `--open`, `--assignee <handle|me>`,
  `--label`, `--priority P0..P4`, `--search <text>` (name and description, any case). A repeated filter
  matches any of its values.
- `--sort rank|priority|created|updated|due`. The default is Stage order, then Rank. `priority` puts
  `P0` first, `updated` newest first, `due` soonest first.
- Story Keys are case-insensitive (`web-42` is `WEB-42`) and need no `--board`.
- A Story's JSON has `key`, `name`, `description` (markdown), `stage`, `rank`, `assignees`, `priority`
  (`"P1"` or `null`), `labels`, `dueDate`, `customFields`, `createdBy`, `tasks[]`, and with Plugins on,
  `plugins`.

## 3. Create a Story

```sh
rowbly stories create --board web --name "Login page" \
  --description "Users sign in with email and password." \
  --priority P1 --label auth,frontend --assignee sam --due 2026-11-30 \
  --field area=frontend --field estimate=3 --json --no-prompt
```

- The new Story gets the next key on its Board (the highest number plus one) and goes to the
  bottom of the first Stage, or of `--stage <key>`. Read the key from the JSON output; do not predict it.
- Rules (each violation exits 2 with the valid choices in `details`): Assignees must be in the roster;
  `--assignee me` needs Me set; Priority is `P0`–`P4`; a Label is lower-kebab-case (`auth`, not `Auth` or
  `needs review`); `--due` is `YYYY-MM-DD`; every required Custom Field needs a `--field`.
- Custom Field values are given as `key=value`: `true`/`false`, numbers, `YYYY-MM-DD`, absolute
  `http(s)` URLs, and comma-separated multiselect values. Use `select` and `multiselect` options exactly
  as `config show` lists them.

## 4. Edit a Story

```sh
rowbly stories edit WEB-42 --add-assignee me --add-label in-review --json --no-prompt
rowbly stories edit WEB-42 --priority P0 --due 2026-11-15 --field estimate=5 --json --no-prompt
rowbly stories edit WEB-42 --no-priority --no-due --unset-field estimate --remove-label in-review --json --no-prompt
```

`--assignee` and `--label` **replace** the whole list. Use `--add-…`/`--remove-…` to change one value
without dropping the others. Description flags also replace the description: to append, read it with
`show`, then write back the full text with `--description-file -`.

## 5. Move and rank a Story

```sh
rowbly stories move WEB-42 in-progress --json --no-prompt          # to the bottom of that Stage
rowbly stories move WEB-42 in-progress --top --json --no-prompt
rowbly stories rank WEB-42 --before WEB-40 --json --no-prompt      # or --after <KEY>, --top, --bottom
```

`move` changes the Stage; `rank` reorders a Story within its Stage. An unknown Stage exits 2 and lists
`validStages`.

## 6. Work with Tasks

```sh
rowbly tasks create WEB-42 --name "Build the form" --json --no-prompt    # → WEB-42.1, first Stage
rowbly tasks list WEB-42 --json --no-prompt
rowbly tasks move WEB-42.1 done --json --no-prompt
rowbly tasks edit WEB-42.1 --name "Build the sign-in form" --json --no-prompt
rowbly tasks delete WEB-42.1 --yes --json --no-prompt
```

- Tasks live in their Story's file and use the Board's Stages. They have no Assignees, Priority or Rank;
  they are listed in creation order.
- Task numbers are never reused: after deleting `WEB-42.3`, the next Task is `WEB-42.4`.
- Moving every Task to a done Stage does **not** move the Story. Move the Story yourself.

## 7. Pick up and finish a Story as an agent

1. `rowbly stories show <KEY> --json --no-prompt`. Read the description and Tasks; this is the request.
2. Start: `rowbly stories move <KEY> <first in_progress Stage> --json --no-prompt`. Add
   `--add-assignee me` with `stories edit` only if Me is set and the user wants it.
   To leave a progress note, use `rowbly comments add <KEY> --body "…"`. Comments is a Plugin and
   is off by default. If `comments` is an unknown command, turn it on as `rowbly-plugins` describes,
   and tell the user, since that changes shared configuration. The author is Me, or `null` when Me is
   not set.
3. As each part is done: `rowbly tasks move <KEY>.<n> <done Stage> --json --no-prompt`.
4. Finish: move the Story to the `done` Stage, or to a review Stage if the Board has one and the user
   reviews work. Check: `stories show` reports the expected `stage`, and its Tasks are done.
5. Mention the Story Key in branch names and commit messages (`WEB-42: add login form`). Commit the
   `.rowbly/` changes with the code.

## Delete

`rowbly stories delete WEB-42 --yes --json --no-prompt` removes the Story folder, with its Tasks and Plugin
files. Delete only when the user asks; moving to a `done` Stage is how work is closed. If the
highest-numbered Story is deleted, its key goes to the next new Story.

## Common mistakes

- **HIGH: `--label x` or `--assignee x` on `edit` to add one value.** It replaces the list. Use
  `--add-label` / `--add-assignee`.
- **HIGH: hard-coding `done` or `in-progress`.** Read the Board's Stages and choose by category.
- **HIGH: Title Case or spaced Labels.** A Label must be lower-kebab-case, or the command exits 2.
- **MEDIUM: guessing the next key** when creating several Stories. Read `key` from each `create`
  output. Two branches can both create `WEB-7`; `rowbly-doctor` fixes that after the merge.
- **MEDIUM: listing without a Board.** With several Boards and no current Board, `stories list` exits 2
  (`board required`). Pass `--board` or `--all-boards`.

## Completion

Each change returned the record you expected (exit 0), and `rowbly stories show <KEY> --json --no-prompt`
confirms its final Stage, Assignees and Tasks. If a command exits 6, follow `rowbly-doctor` before you
try again.

For Epics, Specs and Comments on Stories (`--epic`, `--spec`, `rowbly comments`), see `rowbly-plugins`.
