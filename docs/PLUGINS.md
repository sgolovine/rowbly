# Plugins

Rowbly keeps its core small and adds features as Plugins. This page collects the plugin architecture in one place. The terms are in [`CONTEXT.md`](../CONTEXT.md) (Plugin, Built-in Plugin, Plugin Data, Action), and each Plugin has its own glossary, listed in [`CONTEXT-MAP.md`](../CONTEXT-MAP.md). The reasons are in ADR-0009 to ADR-0017.

Nothing on this page is built yet.

## Scope of the first build

- The plugin system, with the whole pipeline (guard, transform, replace, react), tested with fixture Plugins.
- Two Built-in Plugins: [Epics](#epics) and [Specs](#specs).
- Not built: the Git Plugin (designed in ADR-0016), third-party Plugins, dependencies between Plugins, and deleting a Plugin's data.
- Today's core features stay in core.

## Where Plugins live (ADR-0009)

- Each Built-in Plugin is a folder `src/plugins/<id>/`, built into the same bundle as core and listed in one static registry. Only the entry point reads the registry.
- A Plugin imports only the Plugin API. Core never imports a Plugin. A Plugin uses no Node built-in modules; it works outside its own data only through capabilities of the Plugin API (its own `plugins/<id>/` folders, running `git`, opening `$EDITOR`, and others as Plugins need them). The architecture test enforces these rules.
- A Plugin's TUI part loads only when the TUI starts.
- Plugins run in registry order.

## Turning Plugins on and off (ADR-0010)

```json
{
  "version": 1,
  "assignees": [],
  "plugins": {
    "epics": { "enabled": true },
    "specs": { "enabled": false }
  }
}
```

- A Plugin is off until its entry in `rowbly.config.json` has `enabled: true`. `enabled` is the only key core reserves; the Plugin's settings sit beside it.
- A Board can change a Plugin's settings in its own bag in `board.config.json`, by the Configuration Cascade rules (ADR-0005). Only the Data Root turns a Plugin on or off.
- `rowbly init` turns no Plugins on.

```text
rowbly plugins list          # every Built-in Plugin, whether it is on, and any that failed to load
rowbly plugins show <id>
rowbly plugins enable <id>
rowbly plugins disable <id>  # sets enabled to false; deletes no data
```

In the TUI, a **Plugins** section in the settings (`,`) does the same.

A Plugin that fails to load (it throws while it starts, its settings are invalid, or this Rowbly version does not have it) is skipped. Rowbly warns once per run, on stderr or as a toast, keeps the Plugin's data unchanged, and `rowbly doctor` reports `PLUGIN_FAILED`.

## Plugin Data and Plugin files (ADR-0011, ADR-0013)

```text
.rowbly/
  rowbly.config.json        # "plugins": { "<id>": { "enabled": true, …settings } }; Assignee bags in the roster
  local.json                # per-developer bags, never committed
  plugins/<id>/…            # Data Root files of a Plugin, e.g. Epics
  boards/<board>/
    board.config.json       # Board bags (settings that cascade)
    plugins/<id>/…          # Board files of a Plugin, e.g. Board Specs
    stories/<KEY>/
      story.json            # Story bags, and Task and Comment bags inside it
      plugins/<id>/…        # Story files of a Plugin, e.g. the Story Spec
```

- A bag is `"plugins": { "<id>": { … } }` on a record. Each Plugin validates its own bag. Core keeps every bag unchanged, including the bags of Plugins that are off or unknown, and `--json` prints records as they are stored, with every bag.
- Deleting a Story or a Board deletes its Plugin files. `doctor --fix` moves a Story's whole folder when it renumbers the Story.

## Operations (ADR-0012)

Every Service Layer operation, from core or from a Plugin, collects a Change Set (each record created, changed or deleted, with before and after) and saves it once at the end.

- **Guard**: sees the operation's name, input and Change Set before the save, and can reject the operation. Nothing is saved; exit 4 (`CONFLICT`).
- **Transform**: changes the Change Set before the save.
- **Replace**: runs instead of the core operation. It must be declared. For now only operations can be replaced.
- **React**: sees the Change Set after the save, and acts only outside Rowbly's data. Command mode waits for reactions; the TUI does not block on them. A failure warns, and the exit code stays 0.
- An error thrown by a guard, a transform or a replacement fails the operation: nothing is saved, exit 1 (`INTERNAL`). The message names the Plugin and says how to turn it off.
- With `--json`, errors from Plugins carry `details.plugin`.
- Plugin input reaches an operation as `plugins: { <id>: … }` in the operation's input. A Plugin's CLI options and TUI form fields fill it.
- Doctor fixes are operations too.

## Names and clashes

- A Plugin's commands are under one top-level command named after its id, for example `rowbly epics …`. A Plugin may also add options to core commands.
- A clash that is not a declared replacement, such as a flag, a key or a name that core or an earlier Plugin already uses, makes the later Plugin fail to load.

## Surfaces

Every data change a Plugin offers works in both the CLI and the TUI.

Slots that Plugins can add to now: commands, options on core commands, screens, home menu entries, settings sections, Story form fields, Story filters (the Stories list and the board), Story detail tabs and rows, Board detail sections, `stories show` rows, and Actions. Board card lines, `stories list` columns and the other closed lists open when a Plugin first needs them.

**Actions** (ADR-0017) are TUI only. An Action names a target (a Board, a Story, a Task, or nothing) and shows wherever that target is in focus, in the footer and the help, and as a button in the header. A data change made by an Action must also be a Plugin command or a Plugin option on a core command.

## Doctor

- A Plugin that is on adds checks and fixes for its own files and bags, with codes prefixed by its id, such as `EPICS_MISSING_EPIC`.
- `PLUGIN_FAILED` (error): a Plugin that is on failed to load.
- The files and bags of a Plugin that is off or unknown are not checked; doctor reports them once, as info.

## Epics

The Epic model from before ADR-0008, as a Built-in Plugin (ADR-0014). Terms: [`src/plugins/epics/CONTEXT.md`](../src/plugins/epics/CONTEXT.md).

- An Epic is `.rowbly/plugins/epics/<epic>.json`: `version`, `id`, `name`, `description`, `closed`, `createdAt`, `updatedAt`.
- A Story's Epic is in its Epics bag, for example `"plugins": { "epics": { "epic": "auth" } }`.

```text
rowbly epics list [--closed|--all]                 # open Epics by default
rowbly epics create <id> --name <n> [description flags]
rowbly epics show <id>                             # with its Stories, grouped by Board, and Epic Progress
rowbly epics edit <id> [--name <n>] [description flags]
rowbly epics close <id>
rowbly epics reopen <id>
rowbly epics delete <id>                           # unlinks its Stories, with a warning
rowbly stories list … [--epic <id> | --no-epic]
rowbly stories create … [--epic <id>]
rowbly stories edit … [--epic <id> | --no-epic]
```

- TUI: an Epics entry in the home menu, the Epic list and Epic detail with Epic Progress, an Epic select in the Story form, an Epic filter, and an Epic row on the Story screen.
- `stories show` has an Epic row.
- Doctor: `EPICS_MISSING_EPIC` (warning), for a Story that links to an Epic that does not exist. `--fix` unlinks it, as before.
- Epic data from before ADR-0008 is not migrated.

## Specs

Spec documents for Stories and Boards (ADR-0015). Terms: [`src/plugins/specs/CONTEXT.md`](../src/plugins/specs/CONTEXT.md).

- A Board Spec is `boards/<board>/plugins/specs/<slug>.md`. A Story Spec is `boards/<board>/stories/<KEY>/plugins/specs/spec.md`. The first `# ` heading is the title.
- A Story has at most one Story Spec, and its Specs bag links to any number of Board Specs of its own Board, by slug.
- Deleting a Board Spec unlinks it from every Story, with a warning. A Board that has Board Specs is not deleted without `--force` (exit 4), even when it has no Stories.

```text
rowbly specs list [--board <id>]                                       # Board Specs
rowbly specs create <slug> --title <t> [--text <md>|--file <path|->|--edit] [--board <id>]
rowbly specs show <slug> [--board <id>]
rowbly specs edit <slug> [--title <t>] [--text <md>|--file <path|->|--edit] [--board <id>]
rowbly specs delete <slug> [--board <id>]                              # confirms; --yes when not interactive
rowbly specs create|show|edit|delete --story <KEY> …                  # the Story Spec of a Story
rowbly stories create … [--spec <slug>…]
rowbly stories edit … [--spec <slug>… | --add-spec <slug>… | --remove-spec <slug>…]
rowbly stories list … [--spec <slug>…]
```

`--story <KEY>` names a Story Spec, because Story Keys are case-insensitive and `web-1` is also a valid slug.

- TUI: a **Spec** tab on the Story screen (the Story Spec, then the Board Specs it links to), a **Specs** multi-choice of the Board's Board Specs in the Story form, a **Specs** entry in the home menu to list, create, edit and delete the Board's Board Specs, a list of Board Specs in the Board detail, and a Spec filter on the Stories list and the board. Specs are edited in the multi-line text box.

## Open details for implementation

These were not decided in the design interview:

- The shape of the Plugin API: its module, and how a Plugin declares its contributions.
- Operation names, and the shape of a Change Set, for example how a renumbered Story appears in it.
- The order of handlers. Suggested: a replacement (if any) produces the Change Set, then transforms, then guards, so that a guard sees the final Change Set.
- The key names inside each bag, such as `epic` for Epics and the list of linked Board Specs for Specs.
- A doctor code for a Story that links to a missing Board Spec, and whether `--fix` unlinks it.
- How each Plugin's `_Avoid_` words reach the language test.
- Updates to the README (it still shows `stories/<KEY>.json`), `docs/ARCHITECTURE.md` and `docs/spec/contracts.md`.
