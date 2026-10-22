# Rowbly CLI rules

Follow these rules for every `rowbly` call this skill makes.

Rowbly is a Kanban tracker that keeps its data as JSON files in a `.rowbly/` folder, usually committed
in the code repository. It has two modes: `rowbly` with no command opens a full-screen TUI, and
`rowbly <noun> <verb> …` runs one command and exits. **Agents use only command mode.**

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

Repeatable flags (`--label`, `--stage`, `--priority`, `--field key=value`, and the Assignees Plugin's
`--assignee`) may be repeated or comma-separated.

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
| 1 | `INTERNAL` | A bug, an unreadable file, or a Plugin that failed during a change. Nothing was saved | Report it with the message; if `details.plugin` is set, check `rowbly plugins list --json --no-prompt` |
| 2 | `USAGE` | Bad flags, a missing value, no Board in context, or no `--yes` | Fix the command line; the `hint` says how |
| 2 | `VALIDATION` | Input that breaks a rule (unknown Stage, Assignee or Custom Field, bad Label) | Use a valid value from `details` |
| 3 | `NOT_FOUND` | Unknown Board, Story, Task, Comment, Stage, Custom Field or Assignee | List the records and check the id |
| 4 | `CONFLICT` | The id or key prefix exists, a deletion is refused, a Plugin refused the change, or the Data Root lock stayed busy for 10 s | Read the message; do not force a refusal without the user's approval |
| 5 | `NO_DATA_ROOT` | No `.rowbly/` found, or the Data Root named by `--data-root` or the default is missing (`details.path`) | Check the directory or the path; create one only if the user wants it (`rowbly init`) |
| 6 | `DATA_INTEGRITY` | A file is not valid JSON, fails its schema, has git conflict markers, or an interrupted commit could not finish; `details.path` names it | Run `rowbly doctor --json --no-prompt`, then `rowbly doctor --fix --json --no-prompt` |

## 4. Know which Data Root and Board a command acts on

- **Data Root.** Rowbly opens the first of: `--data-root <path>`; the Data Root marked
  `"default": true` in `~/.rowblyrc.json`; `.rowbly/` in the current directory or the nearest parent,
  like git looks for `.git`; `~/.rowbly`. The path is the `.rowbly` folder itself, not the code
  folder: `--data-root ~/code/app/.rowbly`. A default in `~/.rowblyrc.json` wins over the current
  directory, so pass `--data-root` whenever the user names a Data Root. `--root` and `ROWBLY_ROOT` no
  longer exist; a run with `ROWBLY_ROOT` set exits 2.
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
only thing you may edit by hand is a Plugin's settings in `rowbly.config.json`: the keys beside its
`enabled` key, never `enabled` itself. After a hand edit or a git merge, run `rowbly doctor`.

Never commit `.rowbly/local.json`, `.lock`, `.lock.break` or `.txn/`. The `.gitignore` that `rowbly init`
writes excludes them. Commit everything else in `.rowbly/` with the code it describes.

Every run of Rowbly creates `~/.rowblyrc.json`, the user's Home Config, outside every Data Root. Leave it
in place: do not delete, rewrite or commit it.

## Use Rowbly's words

Rowbly's help, errors and files use these names; use them in commands, commit messages and replies.

| Term | Meaning | Not |
| --- | --- | --- |
| Data Root | The `.rowbly/` folder | workspace, project, database |
| Board | A Kanban board with a key prefix such as `WEB` | project |
| Story | The unit of work on a Board, keyed `WEB-42` | issue, ticket, card |
| Task | A smaller item inside one Story, `WEB-42.1` (the Tasks Plugin) | subtask, checklist item |
| Stage | A step of a Board's workflow, in a Stage Category `backlog` (the fixed first Stage), `board` or `done` (the fixed last Stage) | status, column |
| Rank | A Story's position inside its Stage | order |
| Me / Assignee | The handle you work as (`rowbly whoami`) / a person in the Assignees Plugin's roster | user, owner |
| Priority / Label | `P0` (most urgent) to `P4` / a lower-kebab-case tag | severity / tag |

## Common mistakes

- **HIGH: omitting `--no-prompt` in an agent shell.** If the shell is a terminal, a missing `--name` or
  confirmation waits for input forever. Always pass `--no-prompt`.
- **HIGH: retrying a failed command unchanged.** An exit of 2, 3 or 4 is deterministic. Read
  `error.details` and `hint`, then change the input.
- **HIGH: assuming Stage keys.** Stages are configured per Board; `done` or `in-progress` may not exist.
  Read them with `rowbly config show --board <id> --json --no-prompt`.
- **MEDIUM: `--data-root` pointed at the code folder.** `--data-root ~/code/app` is treated as an
  empty Data Root and reports missing Boards. Point at `~/code/app/.rowbly`.
- **MEDIUM: several default Data Roots.** Without `--data-root`, every command exits 2 listing the
  `~/.rowblyrc.json` entries marked default; `rowbly doctor --data-root <path>` reports them as
  `MULTIPLE_DEFAULT_DATA_ROOTS`. Pass `--data-root <path>`; ask the user which default to keep before
  editing the file.
- **MEDIUM: parsing table output.** Tables change with terminal width and colour. Parse `--json` only.
