# The plugin system

Rowbly keeps its core small and adds features as Plugins. This page explains how the plugin system works. The terms are in the [glossary](../agents/CONTEXT.md) (Plugin, Built-in Plugin, Plugin Data, Action), and each Plugin has its own glossary, listed in the [context map](../agents/CONTEXT-MAP.md). The decisions are ADR-0009 to ADR-0021 ([index](../adr/README.md)).

| Page | What it covers |
| --- | --- |
| [Built-in Plugins](built-in.md) | Epics, Specs and Comments: their data, commands, TUI and doctor checks |
| [Writing a Plugin](writing-a-plugin.md) | Tutorial: from a five-line Plugin to fields, commands, screens, guards, files, doctor and tests |
| [Plugin API reference](api.md) | Every contract a Plugin can rely on |
| [Compatibility policy](compatibility.md) | API versions, data formats, migrations and dependencies |
| [Trust model](trust.md) | Which Plugin code runs, and what the safeguards are not |

## Status

Built:

- The Plugin API, the registry and loading; the operation pipeline (guard, transform, replace, react) with the Data Root lock and commit journal; Plugin Data and Plugin files; the `plugins` commands and the TUI **Plugins** settings section; every slot listed under [Surfaces](#surfaces).
- The Built-in Plugins [Epics](built-in.md#epics), [Specs](built-in.md#specs) and [Comments](built-in.md#comments).

Planned, not built:

- The Git Plugin and the Plugin API's `git` capability ([ADR-0016](../adr/0016-git-automation-design.md)).
- Third-party Plugins, dependencies between Plugins, and deleting a Plugin's data. The rules that must hold first are in [compatibility.md](compatibility.md) and [trust.md](trust.md).

## Where Plugins live

- Each Built-in Plugin is a folder `src/plugins/<id>/`, built into the same bundle as core and listed in one static registry, `builtInPlugins` in `src/plugins/index.ts`. Only the entry point, `src/cli.ts`, reads the registry ([ADR-0009](../adr/0009-built-in-plugins-use-only-the-plugin-api.md)).
- A Plugin imports only the Plugin API (`src/plugin-api`, and `src/plugin-api/tui` from its TUI part) and its own files. Core never imports a Plugin. A Plugin uses no Node built-in module: it works outside its own data only through capabilities of the Plugin API, today its own `plugins/<id>/` folders (`files`) and `$EDITOR` (`editText`, command mode only). `test/architecture.test.ts` enforces these rules. They are conventions for trusted code, not confinement ([trust.md](trust.md#2-what-the-safeguards-are-and-what-they-are-not)).
- A Plugin's TUI part loads only when the TUI starts, so command mode never loads Ink or React for it. The registry and every Built-in Plugin's definition module are evaluated on every run, even for Plugins that are off; a throw at the top level of such a module stops Rowbly from starting.
- Plugins run in registry order.

## Turning Plugins on and off

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

- A Plugin is off until its entry in `rowbly.config.json` has `"enabled": true`. The file is committed, so everyone who uses the Data Root has the same Plugins on ([ADR-0010](../adr/0010-plugins-are-turned-on-per-data-root.md)). `rowbly init` turns no Plugins on.
- `enabled` is the only key core reserves. Only the Data Root turns a Plugin on or off; a Board can only change its settings.

```text
rowbly plugins list          # every Built-in Plugin, whether it is on, and any that failed to load
rowbly plugins show <id>     # the stored Data Root entry, without enabled
rowbly plugins enable <id>
rowbly plugins disable <id>  # sets enabled to false; deletes no data
```

In the TUI, the **Plugins** section of the settings (`,`) does the same. Command mode reads the configuration on every run; the TUI loads its Plugins at start and again each time one is turned on or off there. A Plugin's `start` runs on every load, and there is no teardown. An exact `rowbly --version` loads no Plugins.

### When a Plugin fails to load

A Plugin is skipped **as a whole** when its settings are invalid, its `start` throws, its commands, options or TUI part fail to attach, one of its names clashes, or this Rowbly does not have it (for example, a teammate uses a newer version). It keeps none of its names, and its data stays unchanged.

- Command mode warns once per run on stderr. The TUI warns once per Data Root, Plugin and reason.
- `rowbly plugins list` shows it as failed with the reason, and `rowbly doctor` reports `PLUGIN_FAILED`.
- A Plugin refused because it clashed with an earlier one is not retried when that earlier Plugin fails later in the same run, so the result depends only on the registry order and the configuration.

## Settings

A Plugin's settings are its entry in `rowbly.config.json`, beside `enabled`. Rowbly has no generic settings editor: edit the file by hand, or use the Plugin's own commands or screens when it has them.

```json
{
  "version": 1,
  "assignees": [],
  "plugins": {
    "points": { "enabled": true, "label": "Estimate", "max": 8 }
  }
}
```

- **A required setting.** If a Plugin's settings schema requires a value, `rowbly plugins enable <id>` refuses (`VALIDATION`, exit 2, hint ``fix "plugins.<id>" in rowbly.config.json``) until it is there. Add it by hand, then run `plugins enable <id>`, or set `"enabled": true` in the same edit.
- **Keep `enabled`** when you edit by hand. Only `plugins enable`, `plugins disable` and the TUI's Plugins section should change it; Plugins themselves never can.
- **Board settings.** A Board changes a Plugin's settings in `board.config.json`, under `"plugins": { "<id>": { … } }`. The Board's bag is deep-merged over the Data Root entry: objects merge key by key, lists and other values replace. `enabled` in a Board bag means nothing.
- **When a change takes effect.** Command mode reads the files on every run. The TUI reads the Data Root entry when it loads Plugins; a Plugin reads Board settings each time it uses them.
- **Checking.** Invalid Data Root settings fail the Plugin's load. An invalid Board bag fails the action that reads it with `VALIDATION` naming the Board. A Plugin may declare its settings strict (`z.strictObject`), so a typo fails the load, or lenient, so unknown keys are ignored. Rowbly never rewrites the stored entry.

## Plugin Data and Plugin files

```text
.rowbly/
  rowbly.config.json        # "plugins": { "<id>": { "enabled": true, …settings } }; Assignee bags in the roster
  local.json                # per-developer bags, never committed
  plugins/<id>/…            # Data Root files of a Plugin, e.g. Epics
  boards/<board>/
    board.config.json       # Board bags (settings that cascade)
    plugins/<id>/…          # Board files of a Plugin, e.g. Board Specs
    stories/<KEY>/
      story.json            # Story bags, and Task bags inside it, e.g. Comments
      plugins/<id>/…        # Story files of a Plugin, e.g. the Story Spec
```

- A **bag** is `"plugins": { "<id>": { … } }` on a record ([ADR-0011](../adr/0011-plugin-data-is-a-bag-per-plugin.md)). Each Plugin validates its own bag. Core keeps every bag unchanged, including the bags of Plugins that are off or unknown and bags that do not parse, and `--json` prints records as they are stored, with every bag.
- A bag that does not parse is never treated as empty: a Plugin shows it as unavailable, and refuses to change it (`DATA_INTEGRITY`, exit 6) until it is repaired or reset ([bags](api.md#plugin-data-bags)).
- **Plugin files** sit in a `plugins/<id>/` folder beside what they belong to ([ADR-0013](../adr/0013-plugin-files-live-beside-what-they-belong-to.md)). Deleting a Story or Board deletes its Plugin files; renumbering a Story moves them with its folder. A Story folder without `story.json` still reserves its Story Key. A file reached through a symbolic link inside `plugins/<id>/` is refused.
- Each Plugin owns the shape of its bags and files. Unversioned built-in bags are legacy v1. A format change, and any migration, follows [compatibility.md](compatibility.md) ([ADR-0021](../adr/0021-plugin-format-and-compatibility-policy.md)): never automatic, never inferred from an unreadable bag.

## Operations and hooks

Every Service Layer operation, from core or from a Plugin, collects a Change Set and saves it once ([Operations](../architecture/operations.md), [ADR-0012](../adr/0012-plugins-intercept-service-operations.md)). Plugins take part through hooks:

- **Transform**: changes the Change Set before the save, through its writer methods only.
- **Guard**: sees the final Change Set, read-only, and can refuse the operation: nothing is saved; exit 4 (`CONFLICT`), with `details.canForce` when `--force` would get past it.
- **Replace**: runs instead of a core operation's body. An advanced capability; no Built-in Plugin uses one.
- **React**: sees the saved Change Set and acts only outside Rowbly's data. Each reaction has 5 s; then Rowbly warns and goes on, and nothing is undone. A failure warns, and the exit code stays 0.

Rules that hold for every hook ([ADR-0020](../adr/0020-plugin-execution-and-data-contracts.md)):

- Hooks see frozen copies and change data only through the Change Set they receive; a writer stops working when its hook returns. A hook cannot start another operation.
- An expected error a Plugin throws (`VALIDATION`, `NOT_FOUND`, `CONFLICT`, `USAGE`, `DATA_INTEGRITY`) keeps its code and exit code; anything else becomes `INTERNAL` (exit 1) with a hint to turn the Plugin off. Both carry `details.plugin`, `details.stage` and, inside an operation, `details.operation`. A failure before the save saves nothing.
- Plugin input reaches an operation as `plugins: { <id>: … }` in the operation's input. A Plugin's CLI options and TUI form fields fill it, and its `inputs` schema checks it before anything runs.
- An operation runs the hooks of the Plugins that were on when it started.

The stage table, the error table and the input rules are in the [reference](api.md#stages-and-capabilities).

## Names and clashes

Clashes are found when the Plugins load. The later Plugin in the registry fails to load when it has:

- an id that is a core command or an earlier Plugin's id (a Plugin's commands are under one top-level command named after its id, `rowbly <id> …`);
- an option flag that a core command or an earlier Plugin has (by name, ignoring `no-`), or either polarity of a global option (`--root`, `--json`, `--yes`, `--prompt`, `--version`, `--help`);
- an Action key that a core screen uses ([`CORE_KEYS`](../../src/tui/keymap.ts)) or an earlier Plugin uses;
- a second replacement of an operation, or a `replaces` key that is not a core operation;
- a hook key in a core namespace (`context`, `assignees`, `boards`, `stages`, `fields`, `stories`, `tasks`, `plugins`, `doctor`) that is not a core operation;
- options on a core command that does not take them (the commands that do are `PluginOptionCommand`);
- a `home` or `settings` link to a missing screen, or two Story tabs, Task tabs or settings sections of one Plugin with the same label.

Option flags are long and lower-kebab-case; `--x` and `--no-x` may pair. Plugin screens, form fields, filter fields and doctor codes are named after the Plugin, so they cannot clash. Hooks on another Plugin's operations (`<plugin>.<op>`) are not checked.

## Surfaces

Every data change a Plugin offers works in both the CLI and the TUI.

Slots Plugins can add to: commands, options on core commands, screens, home menu entries, settings sections, Story form fields, Story filters (the Stories list and the board), Story and Task detail tabs and rows, Board detail sections, `stories show` and `tasks show` rows, and Actions. Board card lines, `stories list` columns and other closed lists open when a Plugin first needs them.

**Actions** ([ADR-0017](../adr/0017-actions-are-tui-only.md)) are TUI only. An Action names a target (a Board, a Story, a Task, or nothing) and shows wherever that target is in focus: in the footer, the help and as a header button. A Task Action gets the Task and its Story. A data change an Action offers must also be a Plugin command or a Plugin option on a core command.

**Containment in the TUI.** A Plugin screen, tab or section that throws while rendering shows a fallback naming the Plugin; the rest of the TUI keeps working, and the Plugin is tried again when the Plugins load again. A Plugin whose form or filter fields fail contributes nothing to that form or filter, and the screen says so.

## Doctor

- A Plugin that is on adds checks and fixes for its own files and bags. Its local codes (uppercase words joined by `_`) are prefixed with its id: `MISSING_EPIC` → `EPICS_MISSING_EPIC`. A code that would form a core code becomes `PLUGIN_FAILED`. Rowbly adds `details.plugin`.
- Checks run read-only and see only Stories stored at their own key's folder; duplicate Story Keys are checked after they are renumbered. Fixes run with doctor's Change Set, in doctor's passes ([Integrity and doctor](../architecture/data-model.md#integrity-and-doctor)).
- Core findings about Plugins: `PLUGIN_FAILED` (error: a Plugin that is on failed to load), `PLUGIN_DATA_INVALID` (warning: a bag of a Plugin that is on does not match its schema) and `PLUGIN_DATA_UNCHECKED` (info: once per Plugin that is off or unknown and has data). The files and bags of a Plugin that is off or unknown are not checked.

## Glossaries and the language test

Each Built-in Plugin has a glossary, `src/plugins/<id>/CONTEXT.md`, linked from [`CONTEXT-MAP.md`](../agents/CONTEXT-MAP.md). `test/e2e/language.test.ts` reads the `_Avoid_` words of each registered Plugin's glossary and checks that Plugin's source and its `rowbly <id>` help pages against them. A missing glossary, one without `_Avoid_` words, or one the context map does not link fails the test. The help test turns every Built-in Plugin on, so Plugin commands and options are checked too.
