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

Features beyond the core come as Plugins. Epics, Specs and Comments are Built-in Plugins (ADR-0014, ADR-0015, ADR-0018); core has none of them. See [`PLUGINS.md`](PLUGINS.md) and ADR-0009 to ADR-0018. ADR-0019 and ADR-0020 set the contracts that the plugin-review remediation is implementing (`docs/spec/plugin-review/`).

The source is in layers; each imports only the layers below it, and `test/architecture.test.ts` enforces it:

| Layer | Path | May import |
| --- | --- | --- |
| Core | `src/core` | — |
| Schemas | `src/schemas` | core |
| Storage | `src/storage` (the only layer that touches `node:fs`) | core, schemas |
| Services | `src/services`, with the plugin host, the operations pipeline and the Plugin types in `src/services/plugins/` | core, schemas, storage |
| Output | `src/output` | core, schemas, services |
| Commands, TUI | `src/commands`, `src/tui` | the layers above |
| Plugin API | `src/plugin-api` (`tui.ts` may also import the TUI) | core, schemas, services, output |
| Plugins | `src/plugins/<id>/` | the Plugin API and their own files only |
| Program | `src/main.ts` | commands, TUI, services, storage, output, core |
| Entry point | `src/cli.ts`, the only reader of the registry `src/plugins/index.ts` | program, Plugins |

<!-- WP09B: update this paragraph once ADR-0019's lock and journal and ADR-0020's stage rules land. -->
Every Service Layer operation runs through `OperationRunner.run`: it fills a Change Set, runs the Plugins' replacement, transforms and guards, saves the Change Set once, then runs their reactions. The entry point loads the Plugins that the Data Root turns on before it builds the program, because their commands and options are part of it.

## Out of Scope

These items are considered out of scope for this application

- Authenticaton and authorization - This tool is intended for individuals or very small pods of people.

