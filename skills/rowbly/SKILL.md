---
name: rowbly
description: "Use whenever an agent works with Rowbly, the file-backed Kanban
  tracker kept in a .rowbly/ folder: running the rowbly command non-interactively
  (--json, --no-prompt, --yes, exit codes, JSON errors), setting up a Data Root,
  Boards, Me, Stages and Custom Fields, tracking Stories (keys like WEB-42),
  turning Plugins on and using them (Assignees, Tasks, Epics, Specs, Comments,
  automatic Git commits), and checking or repairing a Data Root with rowbly
  doctor after a git merge or an exit 6. Not for writing a new Plugin."
---

# Operate Rowbly as an agent

Rowbly is a Kanban tracker that keeps its data as JSON and Markdown files in a `.rowbly/` folder, usually
committed in the code repository. It has two modes: `rowbly` with no command opens a full-screen TUI,
and `rowbly <noun> <verb> …` runs one command and exits. **Agents use only command mode.**

Follow the rules on this page for every `rowbly` call, then read the reference for the task:

| Task | Read |
| --- | --- |
| Create a Data Root, add Boards, set Me, change Stages or Custom Fields | [Setup and configuration](references/setup.md) |
| Find, create, edit, move, rank or delete Stories; pick up and finish a Story | [Stories](references/stories.md) |
| See which Plugins are on, turn one on or off, edit Plugin settings, a Plugin that failed to load | [Plugins](references/plugins.md) |
| Who works on a Story (`rowbly assignees`, `--assignee`) | [Assignees Plugin](references/plugin-assignees.md) |
| Smaller items inside a Story (`rowbly tasks`, `WEB-42.1`) | [Tasks Plugin](references/plugin-tasks.md) |
| Group Stories from any Boards (`rowbly epics`, `--epic`) | [Epics Plugin](references/plugin-epics.md) |
| Markdown documents for Stories and Boards (`rowbly specs`, `--spec`) | [Specs Plugin](references/plugin-specs.md) |
| Notes on a Story (`rowbly comments`) | [Comments Plugin](references/plugin-comments.md) |
| Blocking relationships between Stories (`rowbly story-linking`) | [Story Linking Plugin](references/plugin-story-linking.md) |
| Commit Rowbly changes to git automatically (`rowbly git`) | [Git Plugin](references/plugin-git.md) |
| After a git merge, pull or rebase that touched `.rowbly/`, an exit 6, or a hand edit | [Check and repair a Data Root](references/doctor.md) |
| What each file under `.rowbly/` is, what to commit, the Home Config | [Data Root layout](references/data-root.md) |
| The user asks how to do something in the TUI | [The TUI, for the user](references/tui.md) |

## 1. Check that Rowbly can run

```sh
rowbly --version
```

Success: a version number. If `rowbly` is not on `PATH` and you are inside the Rowbly source repository,
use `pnpm dev <args>` (runs from source) or `node dist/cli.js <args>` after `pnpm build`. Do not install
Rowbly globally without the user's permission.

## 2. Call every command non-interactively

Add `--json` to every command whose output you will read, and `--no-prompt` to every command. Add
`--yes` only to a destructive command that the user asked for. The references leave these flags out of
some examples to keep them short; add them anyway.

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

Repeatable flags (`--label`, `--stage`, `--priority`, `--field key=value`, and Plugin options such as
`--assignee` and `--spec`) may be repeated or comma-separated. Every command has `--help`, which also
lists the options that Plugins that are on add.

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
| 2 | `USAGE` | Bad flags, a missing value, no Board in context, no `--yes`, or a command of a Plugin that is off | Fix the command line; the `hint` says how |
| 2 | `VALIDATION` | Input that breaks a rule (unknown Stage, Assignee or Custom Field, bad Label) | Use a valid value from `details` |
| 3 | `NOT_FOUND` | Unknown Board, Story, Task, Comment, Stage, Custom Field, Assignee, Epic or Spec | List the records and check the id |
| 4 | `CONFLICT` | The id or key prefix exists, a deletion is refused, a Plugin refused the change, or the Data Root lock stayed busy for 10 s | Read the message; do not force a refusal without the user's approval |
| 5 | `NO_DATA_ROOT` | No `.rowbly/` found, or the Data Root named by `--data-root` or the default is missing (`details.path`) | Check the directory or the path; create one only if the user wants it (`rowbly init`) |
| 6 | `DATA_INTEGRITY` | A file is not valid JSON, fails its schema, has git conflict markers, or an interrupted commit could not finish; `details.path` names it | Follow [Check and repair a Data Root](references/doctor.md) |

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
- Pass `--board` explicitly in scripts. `local.json` belongs to the developer, and changing it with
  `rowbly use` changes their context too.

Check: before a series of changes, run `rowbly use --json --no-prompt` or a `list` command, and confirm
it reports the Data Root and Board that you expect.

## 5. Change data only through commands

Every command takes the Data Root lock, validates its input, and saves through a journal that survives a
crash. Editing files under `.rowbly/` by hand bypasses all of that. Use commands for every change. The
only thing you may edit by hand is a Plugin's settings in `rowbly.config.json` or `board.config.json`:
the keys beside its `enabled` key, never `enabled` itself. After a hand edit or a git merge, run
`rowbly doctor`.

Never commit `.rowbly/local.json`, `.lock`, `.lock.break` or `.txn/`. The `.gitignore` that `rowbly init`
writes excludes them. Commit everything else in `.rowbly/` with the code it describes.

Every run of Rowbly creates `~/.rowblyrc.json`, the user's Home Config, outside every Data Root. Leave it
in place: do not delete, rewrite or commit it. It holds global Me: `rowbly whoami <handle>` and
`whoami --clear` change Me in every Data Root on the machine, while `whoami --local` changes only the
Data Root in context. Change global Me only when the user asks.

## 6. Plugins are off until the Data Root turns them on

Rowbly ships seven Built-in Plugins: Assignees, Tasks, Epics, Specs, Comments, Story Linking and Git. Each is off until
the Data Root turns it on, and turning one on changes the Data Root for everyone who uses it. While a
Plugin is off, its command is unknown (`rowbly tasks` exits 2 with the hint `Plugin "tasks" is off`)
and so are its options on core commands (`--assignee` exits 2 with `unknown option`). Check with
`rowbly plugins list --json --no-prompt`. Turn a Plugin on only when the user's request needs it, and
say that you did; ask first for Assignees and Git. See [Plugins](references/plugins.md).

## 7. Keep the Story's Stage current

When you work on a Story, its Stage shows the user where the work is. Move it yourself, without being
asked:

- **Create** a Story in the `backlog` Stage (the default; leave out `--stage`) unless the user names
  another Stage.
- **Start development**: before you change any code, move the Story to the in-progress Stage
  (`in-progress` on most Boards; see [Stories](references/stories.md) §1 for a Board without one).
- **Complete the work**: move the Story to `done` as your last step.

```sh
rowbly stories move WEB-42 in-progress --json --no-prompt
rowbly stories move WEB-42 done --json --no-prompt
```

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
| Epic | A group of Stories from any Boards (the Epics Plugin) | — |
| Story Spec / Board Spec | A Markdown document of one Story / of a Board that Stories link to (the Specs Plugin) | — |
| Comment | A note on a Story (the Comments Plugin) | — |

## Common mistakes

- **HIGH: omitting `--no-prompt` in an agent shell.** If the shell is a terminal, a missing `--name` or
  confirmation waits for input forever. Always pass `--no-prompt`.
- **HIGH: retrying a failed command unchanged.** An exit of 2, 3 or 4 is deterministic. Read
  `error.details` and `hint`, then change the input.
- **HIGH: assuming Stage keys.** Stages are configured per Board; `todo` or `in-progress` may not exist.
  Read them with `rowbly config show --board <id> --json --no-prompt`.
- **HIGH: editing files under `.rowbly/` to make a change or silence an error.** Use the commands, and
  `rowbly doctor --fix` for repairs.
- **MEDIUM: `--data-root` pointed at the code folder.** `--data-root ~/code/app` is treated as an
  empty Data Root and reports missing Boards. Point at `~/code/app/.rowbly`.
- **MEDIUM: several default Data Roots.** Without `--data-root`, every command exits 2 listing the
  `~/.rowblyrc.json` entries marked default; `rowbly doctor --data-root <path>` reports them as
  `MULTIPLE_DEFAULT_DATA_ROOTS`. Pass `--data-root <path>`; ask the user which default to keep before
  editing the file.
- **MEDIUM: parsing table output.** Tables change with terminal width and colour. Parse `--json` only.

## Completion

Each call you made exited 0, or you handled its exit code as described in the table above. A Story you
worked on is in the Stage that matches its work (§7). Report any
change you could not make, with its `error.code` and message, and any Plugin you turned on.
