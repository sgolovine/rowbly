# Built-in Plugins

Rowbly ships five Built-in Plugins. Each is off until a Data Root turns it on with `rowbly plugins enable <id>` ([Turning Plugins on and off](README.md#turning-plugins-on-and-off)). Their operations, inputs and results are in [Operations](../architecture/operations.md#built-in-plugin-operations).

| Plugin | Adds | Glossary | Decision |
| --- | --- | --- | --- |
| [Assignees](#assignees) | A roster of Assignees, and the Assignees of each Story | [`assignees/CONTEXT.md`](../../src/plugins/assignees/CONTEXT.md) | [ADR-0023](../agents/adr/0023-assignees-are-a-built-in-plugin.md) |
| [Tasks](#tasks) | Tasks inside Stories, each with its own Stage | [`tasks/CONTEXT.md`](../../src/plugins/tasks/CONTEXT.md) | [ADR-0022](../agents/adr/0022-tasks-are-a-built-in-plugin.md) |
| [Epics](#epics) | Groups of Stories across Boards, with Epic Progress | [`epics/CONTEXT.md`](../../src/plugins/epics/CONTEXT.md) | [ADR-0014](../agents/adr/0014-epics-return-as-a-built-in-plugin.md) |
| [Specs](#specs) | Markdown Spec documents for Boards and Stories | [`specs/CONTEXT.md`](../../src/plugins/specs/CONTEXT.md) | [ADR-0015](../agents/adr/0015-specs-are-markdown-files.md) |
| [Comments](#comments) | Comment Threads on Stories | [`comments/CONTEXT.md`](../../src/plugins/comments/CONTEXT.md) | [ADR-0018](../agents/adr/0018-comments-are-a-built-in-plugin.md) |

Long-text flags are `--<name> <text>`, `--<name>-file <path>` (`-` reads stdin) and `--edit` (opens `$VISUAL` or `$EDITOR`).

## Assignees

An Assignee is a person in the Data Root's roster, identified by a handle (a slug). A Story has zero or more Assignees,.

**Data**

- The roster is the file `.rowbly/plugins/assignees/roster.json`: `version` and `assignees`, a list of `{ handle, name, email? }` in the order they were added. Without the file the roster is empty.
- A Story's Assignees are its bag: `"plugins": { "assignees": { "assignees": ["ada", "sam"] } }`. A Story without Assignees has no bag.

**Commands**

```text
rowbly assignees list                                            # * marks Me
rowbly assignees add <handle> --name <name> [--email <email>]
rowbly assignees edit <handle> [--name <name>] [--email <email>]   # at least one, or exit 2; --email "" removes it
rowbly assignees remove <handle>                                 # also from every Story, with a warning
rowbly stories list … [--assignee <h|me>…]                        # Stories with any of these Assignees
rowbly stories create … [--assignee <h|me>…]
rowbly stories edit … [--assignee <h|me>… | --add-assignee <h|me>… | --remove-assignee <h|me>…]
```

**Rules**

- `--assignee` may be repeated or comma-separated. `me` means Me; it exits 2 when Me is not set.
- Added Assignees must be in the roster: otherwise `VALIDATION` (exit 2), with the valid handles in `details.validHandles`. Duplicates are dropped.
- `--assignee` replaces the list and cannot be combined with `--add-assignee` or `--remove-assignee` (exit 2).
- Adding to or removing from a Story whose Assignees bag is invalid fails with `DATA_INTEGRITY` (exit 6); `--assignee` replaces it.
- Removing an Assignee from the roster takes the handle off every Story and stamps each Story's `updatedAt`. Me is not cleared.

**TUI:** an **Assignees** section in the settings (`,`) with the roster, an Assignee's detail (Edit, Remove) and form; an Assignees multi-choice in the Story form; Assignees and "Assigned to me" in the filter of the Stories list and the board; `@handle` on board cards and Story list rows; an Assignees row on the Story screen.

**Doctor**

- `ASSIGNEES_ROSTER_UNAVAILABLE` (error): the roster file has conflict markers, is not valid JSON, is from a newer Rowbly or fails its schema. Never fixed automatically; every roster change fails with `DATA_INTEGRITY` (exit 6) until it is fixed by hand.
- `ASSIGNEES_UNKNOWN_ASSIGNEE` (warning): a Story has Assignees that are not in the roster; `--fix` removes them and stamps the Story's `updatedAt`.
- `ASSIGNEES_UNKNOWN_ME` (warning): Me is not in the roster; `--fix` clears Me from Local State.

## Tasks

A Task is a smaller unit of work inside exactly one Story, with its own name, description and Stage. It has no Assignees, Priority or Rank of its own: it belongs to the Story's Assignees. Its Task Id is its Story's Story Key, a dot and a number that is never reused in that Story (`WEB-42.3`).

**Data**

- A Story's Tasks are its bag: `"plugins": { "tasks": { "nextNumber": 4, "tasks": [ … ] } }`. The bag is kept, with `nextNumber`, when the last Task is deleted.
- Each Task has `number`, `name`, `description`, `stage`, `createdAt` and `updatedAt`. Its Task Id is derived from the Story Key, so a Story that doctor renumbers keeps its Tasks; command output and `--json` add it as `id`.
- A Task's Stage is one of its Board's effective Stages.

**Commands**

```text
rowbly tasks list <KEY>                                                   # creation order
rowbly tasks create <KEY> --name <name> [--stage <key>] [description flags]  # default Stage: the first one
rowbly tasks show <TASK-ID>
rowbly tasks edit <TASK-ID> [--name <name>] [description flags]           # at least one, or exit 2
rowbly tasks move <TASK-ID> <stage>
rowbly tasks delete <TASK-ID>                                              # confirms; --yes when not interactive
```

Task Ids are case-insensitive (`web-42.3`). `stories show` has a Tasks row (`2/5 done`, judged by Stage Category).

**Rules**

- Moving every Task to a done Stage does not move the Story.
- `stages remove` refuses a Stage that Tasks of the affected Boards still use (`CONFLICT`, exit 4, with `details: { tasks, needsMoveTo: true }`). With `--move-to <stage>`, their Tasks move too, with a warning naming how many.
- A change to the Tasks of a Story whose Tasks bag is invalid fails with `DATA_INTEGRITY` (exit 6) and saves nothing. `tasks list` exits 6 for it, `stories show` prints `Tasks: unavailable (invalid)`, and the TUI tab says so.

**TUI:** a **Tasks** tab on the Story screen (`n` new, `enter` open, `m` move Stage, `e` edit, `d` delete), the Task screen and the Task form; a `✓ done/total` badge on the board card of a Story with Tasks.

**Doctor:** `TASKS_UNKNOWN_STAGE` (error): a Task is in a Stage its Board does not have; move it with `rowbly tasks move`. `TASKS_COUNTER_BEHIND` (warning): `nextNumber` is not above the highest Task number; `--fix` raises it.

## Epics

An Epic groups Stories from any Boards in the Data Root and is identified by a slug. A Story belongs to at most one Epic. Epic Progress is derived from the Stage Categories of the Epic's Stories, never stored.

**Data**

- An Epic is the file `.rowbly/plugins/epics/<epic>.json`: `version`, `id`, `name`, `description`, `closed`, `createdAt`, `updatedAt`.
- A Story's Epic is its bag: `"plugins": { "epics": { "epic": "auth" } }`.

**Commands**

```text
rowbly epics list [--closed|--all]                           # open Epics by default
rowbly epics create <id> --name <name> [description flags]
rowbly epics show <id>                                       # its Stories, grouped by Board, and Epic Progress
rowbly epics edit <id> [--name <name>] [description flags]   # at least one, or exit 2
rowbly epics close <id>
rowbly epics reopen <id>
rowbly epics delete <id>                                     # unlinks its Stories, with a warning
rowbly stories list … [--epic <id> | --no-epic]
rowbly stories create … [--epic <id>]
rowbly stories edit … [--epic <id> | --no-epic]
```

`stories list --epic <id>` takes an Epic ID (a slug); anything else is exit 2. `stories show` has an Epic row.

**TUI:** an Epics entry in the home menu; the Epic list and Epic detail with Epic Progress, where `enter` on a Story opens the Story screen; an Epic select in the Story form (with `No Epic`); an Epic filter (`All Epics` is apart from "no Epic"); an Epic row on the Story screen.

**Errors and doctor**

- An Epic file that is corrupt or from a newer Rowbly is `DATA_INTEGRITY` (exit 6) with `details.path` and `details.problem`. The Epic list shows it as unavailable, and `epics list` warns about it.
- `EPICS_MISSING_EPIC` (warning): a Story links to an Epic file that does not exist; `--fix` unlinks it.
- `EPICS_CONFLICT_MARKERS`, `EPICS_INVALID_JSON`, `EPICS_UNSUPPORTED_VERSION`, `EPICS_SCHEMA_INVALID`, `EPICS_ID_MISMATCH`, `EPICS_UNREADABLE` (errors): an Epic file that cannot be used. Never fixed automatically.

## Specs

A Spec is a Markdown document that describes work to be done; it has no approval or Stage of its own. A **Board Spec** belongs to a Board and is named by a slug; a **Story Spec** belongs to one Story. The first `# ` heading of a Spec is its title.

**Data**

- A Board Spec is `boards/<board>/plugins/specs/<slug>.md`. A Story Spec is `boards/<board>/stories/<KEY>/plugins/specs/spec.md`.
- A Story has at most one Story Spec. Its bag links it to any number of Board Specs of its own Board, by slug: `"plugins": { "specs": { "specs": ["auth", "api"] } }`.

**Commands**

```text
rowbly specs list [--board <id>]                                         # Board Specs
rowbly specs create <slug> --title <title> [--text <text>|--file <path|->|--edit] [--board <id>]
rowbly specs show <slug> [--board <id>]
rowbly specs edit <slug> [--title <title>] [--text <text>|--file <path|->|--edit] [--board <id>]
rowbly specs delete <slug> [--board <id>]                                # confirms; --yes when not interactive
rowbly specs create|show|edit|delete --story <KEY> …                    # the Story Spec of a Story
rowbly stories create … [--spec <slug>…]
rowbly stories edit … [--spec <slug>… | --add-spec <slug>… | --remove-spec <slug>…]
rowbly stories edit … --reset-specs [--spec <slug>…]                      # replaces the stored links, even invalid ones
rowbly stories list … [--spec <slug>…]
```

`--story <KEY>` names a Story Spec, because Story Keys are case-insensitive and `web-1` is also a valid slug.

**Rules**

- Deleting a Board Spec unlinks it from every Story, with a warning, and stamps each Story's `updatedAt`.
- A Board that has Board Specs is not deleted without `--force` (exit 4), even when it has no Stories. In the TUI, a Board blocked only by its Board Specs offers a forced retry after confirmation.
- Changing the links of a Story whose Specs bag is invalid fails with `DATA_INTEGRITY` (exit 6). `--reset-specs` replaces them, alone or with `--spec`, and cannot be combined with `--add-spec` or `--remove-spec`.
- The Spec filter matches a Story that links to any selected Board Spec, and never a Story whose Specs bag is invalid.

**TUI:** a **Spec** tab on the Story screen (the Story Spec, then the linked Board Specs); a **Specs** multi-choice in the Story form; a **Specs** entry in the home menu to list, create, edit and delete Board Specs; a list of Board Specs in the Board detail; a Spec filter on the Stories list and the board. Specs are edited in the multi-line text box.

**Doctor:** `SPECS_MISSING_SPEC` (warning): a Story links to Board Specs that do not exist; `--fix` unlinks them and stamps the Story's `updatedAt`.

## Comments

A Comment is a note attached to a Story. The Comments on one Story, oldest first, are its Thread. Tasks have no Comments ([ADR-0022](../agents/adr/0022-tasks-are-a-built-in-plugin.md)).

**Data**

- A Thread is the bag of its Story: `"plugins": { "comments": { "comments": [ … ] } }`. The bag is removed with the last Comment.
- Each Comment has `id` (8 random characters), `author` (Me, or `null` when Me is not set), `body`, `createdAt` and `updatedAt`.

**Commands**

```text
rowbly comments list <KEY>
rowbly comments add <KEY> [--body <text>|--body-file <path>|--edit]   # --body-file - reads stdin
rowbly comments edit <KEY> <comment-id> [body flags]
rowbly comments delete <KEY> <comment-id>                            # confirms; --yes when not interactive
```

**Rules**

- A body is stored as given; a body that is empty or only whitespace is refused. `--body` is kept exactly; `--body-file`, stdin and `--edit` lose trailing whitespace, as every long-text flag does.
- The author is Me when the Comment is added, read on each add.
- `comments.add` and `comments.update` return the Comment as other Plugins' transforms left it; a transform that removes it fails the operation with `CONFLICT`.
- A change to a Thread that is stored invalid fails with `DATA_INTEGRITY` (exit 6) and saves nothing; repair it by hand, with `rowbly doctor` to find it. `comments list` exits 6 for it, `stories show` prints `Comments: unavailable (invalid)`, and the TUI tab says so.

**TUI:** a **Comments** tab on the Story screen (`c` add, `e` edit, `d` delete) with the Comment form, a multi-line text box. `stories show` and the Details tab have a Comments row with the count.

## Upgrading from before Plugins

Earlier Rowbly versions kept Epics, Comments, Tasks and Assignees in core ([ADR-0008](../agents/adr/0008-no-epics.md), [ADR-0018](../agents/adr/0018-comments-are-a-built-in-plugin.md), [ADR-0022](../agents/adr/0022-tasks-are-a-built-in-plugin.md)). Rowbly has no importer for that data.

- Top-level `comments` arrays on Stories, a Story's `epicId` or `assignees`, the `assignees` roster in `rowbly.config.json`, and Epic files in `epics/*.json`: doctor reports them as `LEGACY_DATA` (warning), never saves those files and never removes the data. Any other change to such a Story drops the old fields; any save of the root config drops the old roster.
- A Story's top-level `tasks` and `nextTaskNumber`, with any Comments on those Tasks: a hard cut-off. Doctor does not report them, and core drops them the next time it saves the Story.

So **commit or back up the Data Root first**, then recreate what you need with the Assignees, Tasks, Epics and Comments Plugins.

## Git

Enable with `rowbly plugins enable git`. The Data Root must be inside a Git repository; activation outside one fails with `VALIDATION` (exit 2). An enabled Plugin loaded outside Git is reported as failed with the same explanation.

Git reacts to all saved Operations, including other Plugins' changes, and creates `chore: update Rowbly data` commits. It commits the affected Rowbly-managed paths, including deletions, but excludes Local State, lock and transaction files. Other paths and unrelated staged changes are preserved. A touched path with staged changes is refused with a warning. Changes made by hand to an affected path are included; establish a clean Data Root baseline before enabling automation. Git ignores still apply.

Personal preferences are in `local.json` under `plugins.git`:

- `frequency`: `change` (default) or `interval`.
- `intervalSeconds`: an integer from 1 to 86400; default 300.
- `authorName` and `authorEmail`: optional; omitted fields use effective `git config user.name` and `user.email`, including repository and global `.gitconfig` settings.

Use `rowbly git show` to inspect these preferences and defaults. Use `rowbly git configure --frequency interval --interval 600`, optionally with `--author-name` and `--author-email`. An empty author flag restores the Git default. In the TUI settings (`,`), **Git** appears when the Plugin is enabled and loaded and offers the same fields. Preferences take effect immediately and are never committed.

Interval mode starts the deadline with the first pending change and batches later changes without moving the deadline. No change means no commit. Pending paths and the deadline persist under Git's own directory, separate for each Data Root and worktree. Timers run only while Rowbly is alive; command mode does not wait for a future deadline. The next Rowbly load resumes pending work and commits it if due. There is no daemon or exit flush. Disabling the Plugin prevents pending commits and retains the pending paths for re-enabling.

Git failures warn after the Rowbly change has saved; the Operation still succeeds. Pending paths remain for the next run to retry. Missing author configuration, an index lock or a merge conflict can prevent a commit. Commit hooks and signing are disabled for Automatic Commits to prevent hook loops and interactive signing prompts. There is no push, automatic branching or hook installation.
