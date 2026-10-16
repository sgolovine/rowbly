# Architecture

- Rowbly is designed to be developer focused
- Rowbly runs as a CLI
  - Default `rowbly` runs the interactive portion.
  - Also runs with commands (ie. `rowbly stories list`)

## Storage Layer

- Storage should be configured to adhere to the core concepts.

- The Data Root holds Boards, Stages, Stories, Tasks and Assignees. There are no Workspaces (ADR-0007). There are no Epics in core (ADR-0008); Epics are a Built-in Plugin (ADR-0014).

- A Board contains Stories

- Each story contains the following:
  - Name
  - Description
  - Custom Fields
  - Stage

- The Stages that a story can be in are configured per board. 

- The Custom Fields that a story can have are configured per board.

- A Story contains a `boardId` field that matches the Board folder it is in. Stages are configuration (ADR-0005), not records, so they have no `boardId`. Tasks are embedded in their Story's `story.json`, so they have no `storyId`; a Task id (`WEB-42.1`) starts with its Story Key.

- The storage layer reads and writes JSON and Markdown files and uses `zod` to make sure everything is correct (ADR-0001). There is no database.

- Use a folder based architecture.
```
.rowbly/
  rowbly.config.json
  local.json
  plugins/<plugin_id>/...
  boards/
    <board_slug>/
      board.config.json
      plugins/<plugin_id>/...
      stories/
        <story_key>/
          story.json
          plugins/<plugin_id>/...

```

## Configuration

Rowbly will be highly configurable. It includes these configuration files

- `rowbly.config.json` (required) - top level configuration file. Also holds the Assignee roster and the Plugin entries (ADR-0010).
- `board.config.json` (required for each Board) - the Board record: its id, name, description, key prefix and timestamps.

The Configuration Cascade (ADR-0005) covers these optional keys:
- `stages` - the stages for stories within a board.
- `customFields` - the custom fields for stories within a board.

Each key may be set in `rowbly.config.json`, in `board.config.json`, or in neither. A Board's own value wins over the top level value; with neither, Stages fall back to the built-in defaults and Custom Fields to none.

## CLI Architecture

- The CLI should be setup with layers.

- We should have the following layers in the system
  - Storage & Configuration Layer - Responsible for reading/writing the JSON and Markdown files under the Data Root and making sure system adheres to the configurations.
  - Service Layer - Consumes the storage layer's repositories to read and change Boards, Stories, Tasks and configuration. It never prints.
  - Command / CLI Layer - Consumes services, this is what gets executed when a user types in a command or does something in the CLI.

The table under [Plugins](#plugins) lists every layer.

## CLI Entrypoints

There will be two ways of using the CLI

- Via commands
- Interactive CLI


Running the CLI without any commands will result in it running interactively. Running with commands will execute just that command.

```
rowbly # interactive TUI

rowbly stories list --board <board_id> # command based

```

## CLI Features

Here is a non-exhaustive list of CLI features we need to cover. Assume that more will be added later. Must be covered in both the Interactive CLI + Command Driven CLI

- CRUD Board Actions
- CRUD Story actions
- CRUD for Board custom fields
- CRUD for board stages
- CRUD for Tasks

## Plugins

Features beyond the core come as Plugins. Epics, Specs and Comments are Built-in Plugins (ADR-0014, ADR-0015, ADR-0018); core has none of them. See [`PLUGINS.md`](PLUGINS.md) and ADR-0009 to ADR-0021: ADR-0019 sets how operations are coordinated and saved, ADR-0020 what Plugin code may do in each stage and how its errors are reported, and ADR-0021 how Plugin data formats change. To write a Plugin, see [`WRITING-A-PLUGIN.md`](WRITING-A-PLUGIN.md) and the [Plugin API reference](plugins/API.md).

The source is in layers; each imports only the layers below it, and `test/architecture.test.ts` enforces it:

| Layer | Path | May import |
| --- | --- | --- |
| Core | `src/core` | — |
| Schemas | `src/schemas` | core |
| Storage | `src/storage` (the only layer that touches `node:fs`) | core, schemas |
| Services | `src/services`, with the plugin host, the operations pipeline and the Plugin types in `src/services/plugins/` | core, schemas, storage; React, Ink and Commander in types only |
| Output | `src/output` | core, schemas, services |
| Commands, TUI | `src/commands`, `src/tui` | the layers above |
| Plugin API | `src/plugin-api` (`tui.ts` may also import the TUI) | core, schemas, services, output |
| Plugins | `src/plugins/<id>/` | the Plugin API and their own files only |
| Plugin test harness | `src/plugin-api/testing.ts`, for tests only: no Plugin and no production module imports it | core, schemas, storage, services, main, Plugin API |
| Program | `src/main.ts` | commands, TUI, services, storage, output, core |
| Entry point | `src/cli.ts`, the only reader of the registry `src/plugins/index.ts` | program, Plugins |

Every Service Layer operation runs through `OperationRunner.run`. It parses the Plugins' input, fills a Change Set with the body (or a Plugin's replacement), runs the transforms and then the guards, saves the Change Set once, then runs the reactions. Each Plugin callback runs in a stage that decides what it may do (ADR-0020 §1), and its errors are attributed to it (ADR-0020 §5). The entry point loads the Plugins that the Data Root turns on before it builds the program, because their commands and options are part of it.

### Saving an operation

ADR-0019 sets how an operation reads and saves the Data Root:

- **One lock per Data Root.** Every service call takes the lock, `.rowbly/.lock`, before its first read, and reads take it too. An operation holds it through its body, hooks, final checks and the commit, and gives it up before its reactions. Rowbly processes therefore run their operations one after another, and each plans from the latest saved records. A busy Data Root waits up to 10 s, then fails with `CONFLICT`; a lock left by a process that died is broken.
- **A journaled commit.** Before writing, Rowbly checks the whole final plan: record schemas, parents, the stored sources of moves and deletions, free destinations, paths and the symlink policy. Then it stages the new files in `.rowbly/.txn/<id>/`, writes a manifest, applies the changes and marks the commit complete. If the process dies, the next Rowbly command (each lock acquisition and opening the Data Root) first recovers: it completes a prepared commit or restores the originals. Single files are written to a temporary file and renamed, so a failed write never truncates a file.
- **Guarantees.** A failure before the commit writes nothing. After a crash the Data Root holds the whole old state or the whole new state of the operation. Rowbly's own reads never see half a commit. The guarantee covers the process dying, not power loss.
- **Outside the lock.** Editors, Git, `cat` and scripts do not take the lock and may see intermediate files. Rowbly detects what it can (conflict markers, schema failures, identity checks, leftovers that doctor reports) but does not protect against them.
- **Local State.** Context changes start from the stored Local State. After a save, the saved Local State becomes the running context's before the reactions run; Me changes only when the stored Me changed.
- `rowbly init` writes a `.gitignore` that keeps `local.json`, `.lock`, `.lock.break` and `.txn/` out of Git; doctor reports a `.gitignore` that lacks one (`GITIGNORE_INCOMPLETE`).

### Doctor

`rowbly doctor` checks the Data Root under the lock. `--fix` repairs in passes: structural repairs (duplicate Story Keys) first, then a fresh check, then the other fixes, at most 5 passes; each pass is planned and saved under the lock. A failed pass saves nothing, and its error lists the passes that did save (`details.committed`). Doctor recognizes the lock and journal files, reports an interrupted commit it could not recover (`TRANSACTION_PENDING`) and leftovers (`TRANSACTION_LEFTOVER`, `TEMP_FILE_LEFTOVER`), and never removes `.moving` folders or orphan folders (`ORPHAN_FOLDER`) by itself. Data from a Rowbly before Plugins is `LEGACY_DATA` ([`PLUGINS.md`](PLUGINS.md#upgrading-from-before-plugins)).

### Testing

- `pnpm test` runs both Vitest projects: `unit` and `cli`. `pnpm test:unit` runs every suite that needs no CLI build (services, storage, TUI) without building anything.
- A suite that calls `runCli` (or names a CLI path) joins the `cli` project. That project builds both CLIs, the real one and the one with the fixture Plugins, into a `.test-dist/run-*` folder of its own and removes it afterwards, so parallel runs and worktrees are safe. Tests never touch `dist/`.
- `pnpm bench:plugins` runs the opt-in performance measurements ([`test/performance/README.md`](../test/performance/README.md)); CI does not.
- `ROWBLY_DEBUG=trace` prints every operation, commit and Plugin callback with its stage, time and outcome to stderr ([Tracing](plugins/API.md#tracing)).

## Out of Scope

These items are considered out of scope for this application

- Authenticaton and authorization - This tool is intended for individuals or very small pods of people.

