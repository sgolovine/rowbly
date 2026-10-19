---
name: rowbly-cli
description: "Use first whenever an agent runs the rowbly command for a
  file-backed Kanban tracker (.rowbly/ folder): how Rowbly finds its Data Root
  and Board, how to run it non-interactively with --json, --no-prompt and --yes,
  how to read exit codes and JSON errors, and why not to open the TUI. Other
  rowbly-* skills build on it."
metadata:
  purpose: >-
    Teach an agent the shared rules for operating the Rowbly CLI safely from a
    script or agent shell: Data Root and Board resolution, non-interactive
    flags, JSON output and errors, exit codes, and the vocabulary Rowbly uses.
  type: core
  library: rowbly
  library_version: 0.1.0
sources:
  - README.md
  - docs/agents/CONTEXT.md
  - docs/architecture/storage.md
  - src/cli.ts
  - src/main.ts
  - src/commands/_shared.ts
  - src/core/errors.ts
---

# Operate the Rowbly CLI as an agent

Rowbly is a Kanban tracker that keeps its data as JSON files in a `.rowbly/` folder, usually committed
in the code repository. It has two modes: `rowbly` with no command opens a full-screen TUI, and
`rowbly <noun> <verb> …` runs one command and exits. **Agents use only command mode.**

Follow these rules for every `rowbly` call. The task skills build on them:

- `rowbly-setup`: create the Data Root, Boards, Assignees, Stages and Custom Fields.
- `rowbly-stories`: find, create, edit and move Stories and Tasks.
- `rowbly-plugins`: Epics, Specs, Comments, and turning Plugins on or off.
- `rowbly-doctor`: check and repair the Data Root, mainly after git merges.

## 1. Check that Rowbly can run

```sh
rowbly --version
```

Success: a version number. If `rowbly` is not on `PATH` and you are inside the Rowbly source repository,
use `pnpm dev <args>` (runs from source) or `node dist/cli.js <args>` after `pnpm build`. Do not install
Rowbly globally without the user's permission.

## 2. Call every command non-interactively

Add `--json` to every command whose output you will read, and `--no-prompt` to every command. Add
`--yes` only to a destructive command that the user asked for.

```sh
rowbly stories list --open --json --no-prompt
rowbly stories delete WEB-7 --yes --json --no-prompt
```

- Rowbly prompts only when stdin and stdout are both terminals and neither `--json` nor `--no-prompt`
  is given. Some agent shells provide a pseudo-terminal, so a missing value can open a prompt that
  never returns. With `--no-prompt`, a missing value exits 2 instead.
- A destructive command (`stories delete`, `tasks delete`, `boards delete`, `comments delete`,
  `specs delete`) without `--yes` exits 2 with `confirmation required` when it cannot prompt.
- Never run bare `rowbly` (it opens the TUI, or exits 2 with help when there is no terminal), and never
  pass `--edit` (it opens `$EDITOR` and waits for a person). Give long text with `--description <text>`,
  or with `--description-file <path>`. Use `--description-file -` to read stdin. It keeps
  the newlines inside the text and drops trailing whitespace:

```sh
printf '%s\n' "## Goal" "" "Users can sign in with email." \
  | rowbly stories create --name "Login page" --description-file - --json --no-prompt
```

Repeatable flags (`--assignee`, `--label`, `--stage`, `--priority`, `--field key=value`) may be
repeated or comma-separated.

## 3. Read results and errors

With `--json`, a successful command prints JSON on stdout: an array for `list`, one record for
`create`, `show`, `edit`, `move` and `rank`, and `{ "deleted": "<id>" }` for `delete`. A failed command
prints nothing on stdout and prints this on stderr:

```json
{"error":{"code":"VALIDATION","message":"unknown Stage \"nope\"","details":{"validStages":["backlog","todo","in-progress","done"]},"hint":"valid Stages: backlog, todo, in-progress, done"}}
```

Read `details` before you try again: it often lists the valid choices (`validStages`, `validHandles`)
or the failing fields (`details.issues`). Warnings, such as `Assignee "sam" removed from 1 story`, go to
stderr even when the command succeeds.

| Exit | `error.code` | Meaning | What to do |
| --- | --- | --- | --- |
| 0 | — | Success | — |
| 1 | `INTERNAL` | A bug, an unreadable file, or a Plugin that failed during a change. Nothing was saved | Report it with the message; if `details.plugin` is set, see `rowbly-plugins` |
| 2 | `USAGE` | Bad flags, a missing value, no Board in context, or no `--yes` | Fix the command line; the `hint` says how |
| 2 | `VALIDATION` | Input that breaks a rule (unknown Stage, Assignee or Custom Field, bad Label) | Use a valid value from `details` |
| 3 | `NOT_FOUND` | Unknown Board, Story, Task, Comment, Stage, Custom Field or Assignee | List the records and check the id |
| 4 | `CONFLICT` | The id or key prefix exists, a deletion is refused, a Plugin refused the change, or the Data Root lock stayed busy for 10 s | Read the message; do not force a refusal without the user's approval |
| 5 | `NO_DATA_ROOT` | No `.rowbly/` found | Check the directory; create one only if the user wants it (`rowbly-setup`) |
| 6 | `DATA_INTEGRITY` | A file is not valid JSON, fails its schema, has git conflict markers, or an interrupted commit could not finish; `details.path` names it | Use `rowbly-doctor` |

## 4. Know which Data Root and Board a command acts on

- **Data Root.** Rowbly looks for `.rowbly/` in the current directory, then in each parent directory,
  like git looks for `.git`. If it finds none it uses `~/.rowbly` when that exists. `--root <path>` or
  `ROWBLY_ROOT` sets it directly. The path is the `.rowbly` folder itself, not the project
  folder: `--root ~/code/app/.rowbly`.
- **Board.** A command that needs a Board takes the first of: `--board <id>`, `ROWBLY_BOARD`, the current
  Board in `.rowbly/local.json` (set with `rowbly use <id>`), or the only Board in the Data Root.
  When there is none, the command exits 2 with `board required`. A Story Key or Task id never needs
  `--board`: its prefix names the Board. `rowbly use --json --no-prompt` shows the current Board and
  where it came from.
- Pass `--board` explicitly in scripts. `local.json` belongs to the developer, and changing it with `rowbly use` changes
  their context too.

Check: before a series of changes, run `rowbly use --json --no-prompt` or a `list` command, and confirm
it reports the Data Root and Board that you expect.

## 5. Change data only through commands

Every command takes the Data Root lock, validates its input, and saves through a journal that survives a
crash. Editing files under `.rowbly/` by hand bypasses all of that. Use commands for every change. The
only file you may edit by hand is a Plugin's settings in `rowbly.config.json`, as `rowbly-plugins`
describes. After a hand edit or a git merge, run `rowbly doctor`.

Never commit `.rowbly/local.json`, `.lock`, `.lock.break` or `.txn/`. The `.gitignore` that `rowbly init`
writes excludes them. Commit everything else in `.rowbly/` with the code it describes.

## Use Rowbly's words

Rowbly's help, errors and files use these names; use them in commands, commit messages and replies.

| Term | Meaning | Not |
| --- | --- | --- |
| Data Root | The `.rowbly/` folder | workspace, project, database |
| Board | A Kanban board with a key prefix such as `WEB` | project |
| Story | The unit of work on a Board, keyed `WEB-42` | issue, ticket, card |
| Task | A smaller item inside one Story, `WEB-42.1` | subtask, checklist item |
| Stage | A step of a Board's workflow, in a Stage Category `todo`, `in_progress` or `done` | status, column |
| Rank | A Story's position inside its Stage | order |
| Assignee / Me | A person in the roster / the Assignee you work as (`rowbly whoami`) | user, owner |
| Priority / Label | `P0` (most urgent) to `P4` / a lower-kebab-case tag | severity / tag |

## Common mistakes

- **HIGH: omitting `--no-prompt` in an agent shell.** If the shell is a terminal, a missing `--name` or
  confirmation waits for input forever. Always pass `--no-prompt`.
- **HIGH: retrying a failed command unchanged.** An exit of 2, 3 or 4 is deterministic. Read
  `error.details` and `hint`, then change the input.
- **HIGH: assuming Stage keys.** Stages are configured per Board; `done` or `in-progress` may not exist.
  Read them with `rowbly config show --board <id> --json --no-prompt` (see `rowbly-stories`).
- **MEDIUM: `--root` pointed at the project folder.** `--root ~/code/app` is treated as an empty Data
  Root and reports missing Boards. Point at `~/code/app/.rowbly`.
- **MEDIUM: parsing table output.** Tables change with terminal width and colour. Parse `--json` only.

## Completion

Each call you made exited 0, or you handled its exit code as described in the table above. Report any
change you could not make, with its `error.code` and message.
