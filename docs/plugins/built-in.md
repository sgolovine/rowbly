# Built-in Plugins

Rowbly ships three Built-in Plugins. Each is off until a Data Root turns it on with `rowbly plugins enable <id>` ([Turning Plugins on and off](README.md#turning-plugins-on-and-off)). Their operations, inputs and results are in [Operations](../architecture/operations.md#built-in-plugin-operations).

| Plugin | Adds | Glossary | Decision |
| --- | --- | --- | --- |
| [Epics](#epics) | Groups of Stories across Boards, with Epic Progress | [`epics/CONTEXT.md`](../../src/plugins/epics/CONTEXT.md) | [ADR-0014](../adr/0014-epics-return-as-a-built-in-plugin.md) |
| [Specs](#specs) | Markdown Spec documents for Boards and Stories | [`specs/CONTEXT.md`](../../src/plugins/specs/CONTEXT.md) | [ADR-0015](../adr/0015-specs-are-markdown-files.md) |
| [Comments](#comments) | Comment Threads on Stories and Tasks | [`comments/CONTEXT.md`](../../src/plugins/comments/CONTEXT.md) | [ADR-0018](../adr/0018-comments-are-a-built-in-plugin.md) |

Long-text flags are `--<name> <text>`, `--<name>-file <path>` (`-` reads stdin) and `--edit` (opens `$VISUAL` or `$EDITOR`).

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

A Comment is a note attached to a Story or a Task. The Comments on one Story or one Task, oldest first, are its Thread; a Story's Thread does not include those on its Tasks.

**Data**

- A Thread is the bag of its Story or Task: `"plugins": { "comments": { "comments": [ … ] } }`. The bag is removed with the last Comment.
- Each Comment has `id` (8 random characters), `author` (Me when Me is in the roster, else `null`), `body`, `createdAt` and `updatedAt`.

**Commands**

```text
rowbly comments list <KEY|TASK-ID>
rowbly comments add <KEY|TASK-ID> [--body <text>|--body-file <path>|--edit]   # --body-file - reads stdin
rowbly comments edit <KEY|TASK-ID> <comment-id> [body flags]
rowbly comments delete <KEY|TASK-ID> <comment-id>                            # confirms; --yes when not interactive
```

**Rules**

- A body is stored as given; a body that is empty or only whitespace is refused. `--body` is kept exactly; `--body-file`, stdin and `--edit` lose trailing whitespace, as every long-text flag does.
- The author is checked against the roster on each add. In a long TUI run, Me may have left the roster.
- `comments.add` and `comments.update` return the Comment as other Plugins' transforms left it; a transform that removes it fails the operation with `CONFLICT`.
- A change to a Thread that is stored invalid fails with `DATA_INTEGRITY` (exit 6) and saves nothing; repair it by hand, with `rowbly doctor` to find it. `comments list` exits 6 for it, `stories show` and `tasks show` print `Comments: unavailable (invalid)`, and the TUI tab says so.

**TUI:** a **Comments** tab on the Story screen and on the Task screen (`c` add, `e` edit, `d` delete) with the Comment form, a multi-line text box. `stories show`, `tasks show` and the Details tabs have a Comments row with the count.

## Upgrading from before Plugins

Earlier Rowbly versions kept Epics and Comments in core ([ADR-0008](../adr/0008-no-epics.md), [ADR-0018](../adr/0018-comments-are-a-built-in-plugin.md)). Rowbly has no importer for that data: top-level `comments` arrays on Stories and Tasks, a Story's `epicId`, and Epic files in `epics/*.json`. Doctor reports them as `LEGACY_DATA` (warning), never saves those files and never removes the data. Any other change to such a Story drops the old fields, so **commit or back up the Data Root first**, then recreate what you need with the Epics and Comments Plugins.
