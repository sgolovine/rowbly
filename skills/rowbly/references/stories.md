# Track work with Stories

Every command below takes `--json --no-prompt`, and a delete also needs `--yes`.

## 1. Learn the Board before you change it

Stage keys and Custom Fields differ per Board. Read them once:

```sh
rowbly boards list --json --no-prompt               # Board ids and key prefixes
rowbly config show --board web --json --no-prompt   # .stages[] {key,name,category}, .customFields[]
rowbly plugins list --json --no-prompt              # which Plugins (Assignees, Tasks, Epics, …) are on
rowbly assignees list --json --no-prompt            # valid handles, with the Assignees Plugin on
rowbly whoami --json --no-prompt                    # {"me": "sam" | null, "source", "global", "local"}
```

Pick Stages by **category**, not by name. Every Board starts with `backlog` (category `backlog`) and
ends with `done` (category `done`). A Board's configured Stages might be `doing`, `review`, with no
`todo` or `in-progress` key. The three Stages an agent uses:

| When | Stage |
| --- | --- |
| A new Story | The `backlog` Stage, unless the user names another Stage |
| Development starts | The in-progress Stage: the `board` Stage whose key or name says work is under way (`in-progress`, `doing`); if none does, the last `board` Stage |
| The work is complete | The `done` Stage |

## 2. Find and read Stories

```sh
rowbly stories list --board web --open --json --no-prompt                      # not in a done Stage
rowbly stories list --board web --assignee me --sort priority --json --no-prompt
rowbly stories list --all-boards --label auth --search login --json --no-prompt
rowbly stories show WEB-42 --json --no-prompt                                  # full Story with its Plugin Data
```

- Filters: `--stage <key>`, `--category backlog|board|done`, `--open`, `--label`, `--priority P0..P4`,
  `--search <text>` (name and description, any case). A repeated filter matches any of its values.
  Plugins that are on add filters: `--assignee <handle|me>` (Assignees), `--epic <id>` / `--no-epic`
  (Epics), `--spec <slug>` (Specs).
- `--sort rank|priority|created|updated|due`. The default is Stage order, then Rank. `priority` puts
  `P0` first, `created` oldest first, `updated` newest first, `due` soonest first.
- Story Keys are case-insensitive (`web-42` is `WEB-42`) and need no `--board`.
- A Story's JSON has `key`, `name`, `description` (markdown), `stage`, `rank`, `priority` (`"P1"` or
  `null`), `labels`, `dueDate`, `customFields`, `createdBy` (Me when it was created), `createdAt`,
  `updatedAt`, and Plugin Data in `plugins`, one entry per Plugin:
  - `plugins.assignees.assignees`: its Assignees, absent when it has none;
  - `plugins.tasks`: `nextNumber` and `tasks[]` stored by `number`; read them with
    `tasks list --json` instead, whose items include each Task's `id`;
  - `plugins.epics.epic`: its Epic;
  - `plugins.specs.specs`: the Board Specs it links to;
  - `plugins.comments.comments`: its Comments.

  Rowbly keeps this data unchanged while its Plugin is off.

## 3. Create a Story

```sh
rowbly stories create --board web --name "Login page" \
  --description "Users sign in with email and password." \
  --priority P1 --label auth,frontend --due 2026-11-30 \
  --field area=frontend --field estimate=3 --json --no-prompt
```

- The new Story gets the next key on its Board (the highest number plus one) and goes to the
  bottom of the first Stage (`backlog`), or of `--stage <key>`. Leave out `--stage` unless the user
  names a Stage. Read the key from the JSON output; do not predict it.
- Rules (each violation exits 2 with the valid choices in `details`): Priority is `P0`–`P4`; a Label is
  lower-kebab-case (`auth`, not `Auth` or `needs review`); `--due` is `YYYY-MM-DD`; every required
  Custom Field needs a `--field`.
- Custom Field values are given as `key=value`: `true`/`false`, numbers, `YYYY-MM-DD`, absolute
  `http(s)` URLs, and comma-separated multiselect values. Use `select` and `multiselect` options exactly
  as `config show` lists them.
- Plugins that are on add options: `--assignee <handle|me>` ([Assignees](plugin-assignees.md)),
  `--epic <id>` ([Epics](plugin-epics.md)), `--spec <slug>` ([Specs](plugin-specs.md)).

## 4. Edit a Story

```sh
rowbly stories edit WEB-42 --name "Sign-in page" --add-label in-review --json --no-prompt
rowbly stories edit WEB-42 --priority P0 --due 2026-11-15 --field estimate=5 --json --no-prompt
rowbly stories edit WEB-42 --no-priority --no-due --unset-field estimate --remove-label in-review --json --no-prompt
```

`--label` (and Plugin list options such as `--assignee` and `--spec`) **replace** the whole list. Use
`--add-…`/`--remove-…` to change one value without dropping the others. Description flags also replace
the description: to append, read it with `show`, then write back the full text with
`--description-file -`.

## 5. Move and rank a Story

```sh
rowbly stories move WEB-42 in-progress --json --no-prompt          # to the bottom of that Stage
rowbly stories move WEB-42 in-progress --top --json --no-prompt
rowbly stories rank WEB-42 --before WEB-40 --json --no-prompt      # or --after <KEY>, --top, --bottom
```

`move` changes the Stage; `rank` reorders a Story within its Stage. An unknown Stage exits 2 and lists
`validStages`. A Story never moves to another Board: create a new Story there and delete the old one
only if the user asks.

## 6. Pick up and finish a Story as an agent

1. `rowbly stories show <KEY> --json --no-prompt`. With the Tasks Plugin on, also
   `rowbly tasks list <KEY> --json --no-prompt`; with the Specs Plugin on,
   `rowbly specs list --story <KEY> --json --no-prompt` and the Board Specs it links to; with the
   Comments Plugin on, `rowbly comments list <KEY> --json --no-prompt`. Read them all: this is the
   request.
2. Start: before you change any code, `rowbly stories move <KEY> <in-progress Stage> --json --no-prompt`
   (see the table in §1). Add
   `--add-assignee me` with `stories edit` only if the Assignees Plugin is on, Me is set, and the user
   wants it.
3. To leave a progress note, blocker or decision, use `rowbly comments add <KEY> --body "…"`
   ([Comments](plugin-comments.md)). If `comments` is an unknown command, turn the Plugin on with
   `rowbly plugins enable comments`, and tell the user, since that changes shared configuration.
4. As each part is done: `rowbly tasks move <KEY>.<n> done --json --no-prompt`
   ([Tasks](plugin-tasks.md)).
5. Finish: when the work is complete, `rowbly stories move <KEY> done --json --no-prompt`. Do this
   yourself, as the last step, without waiting to be asked. Moving every Task to `done` does not move
   the Story. Check: `stories show` reports the `done` Stage, and `tasks list` shows its Tasks done.
6. Mention the Story Key in branch names and commit messages (`WEB-42: add login form`). Commit the
   `.rowbly/` changes with the code, unless the Git Plugin commits them for you
   ([Git](plugin-git.md)).

## 7. Delete

`rowbly stories delete WEB-42 --yes --json --no-prompt` removes the Story folder, with its Tasks,
Comments, Story Specs and other Plugin files. Delete only when the user asks; moving to a `done` Stage is
how work is closed. If the highest-numbered Story is deleted, its key goes to the next new Story.

## Common mistakes

- **HIGH: `--label x` or `--assignee x` on `edit` to add one value.** It replaces the list. Use
  `--add-label` / `--add-assignee`.
- **HIGH: hard-coding `in-progress` or `todo`.** Only `backlog` and `done` exist on every Board. Read the
  Board's Stages and choose the in-progress Stage as the table in §1 says.
- **HIGH: leaving the Story where it was.** Move it to the in-progress Stage when development starts and
  to `done` when the work is complete; the Board is how the user sees progress.
- **HIGH: Title Case or spaced Labels.** A Label must be lower-kebab-case, or the command exits 2.
- **MEDIUM: guessing the next key** when creating several Stories. Read `key` from each `create`
  output. Two branches can both create `WEB-7`; `rowbly doctor --fix` fixes that after the merge
  ([Check and repair a Data Root](doctor.md)).
- **MEDIUM: listing without a Board.** With several Boards and no current Board, `stories list` exits 2
  (`board required`). Pass `--board` or `--all-boards`.

## Completion

Each change returned the record you expected (exit 0), and `rowbly stories show <KEY> --json --no-prompt`
confirms its final Stage and Plugin Data. If a command exits 6, follow
[Check and repair a Data Root](doctor.md) before you try again.
