# Plugins

Rowbly keeps its core small and adds features as Plugins. This page collects the plugin architecture in one place. The terms are in [`CONTEXT.md`](agents/CONTEXT.md) (Plugin, Built-in Plugin, Plugin Data, Action), and each Plugin has its own glossary, listed in [`CONTEXT-MAP.md`](agents/CONTEXT-MAP.md). The reasons are in ADR-0009 to ADR-0021.

To write a Plugin, follow the tutorial, [`WRITING-A-PLUGIN.md`](WRITING-A-PLUGIN.md), and look up the contracts in the [Plugin API reference](plugins/API.md).

The plugin system is built: the Plugin API, the registry, loading, the operations pipeline with its lock and commit journal, Plugin Data and Plugin files, the `plugins` commands and settings section, and the slots below. The Epics, Specs and Comments Built-in Plugins are built.

## Scope of the first build

Built:

- The plugin system, with the whole pipeline (guard, transform, replace, react), tested with fixture Plugins.
- Built-in Plugins: [Epics](#epics), [Specs](#specs) and [Comments](#comments).
- Today's core features stay in core, except Comments, which moved out into a Built-in Plugin (ADR-0018).

Planned, not built:

- The Git Plugin and the Plugin API's `git` capability (designed in ADR-0016).
- Third-party Plugins, dependencies between Plugins, and deleting a Plugin's data. The rules that must hold first are in [`plugins/COMPATIBILITY.md`](plugins/COMPATIBILITY.md) (API and data-format versions, migrations, dependencies) and [`plugins/TRUST.md`](plugins/TRUST.md) (trust model).

## Where Plugins live (ADR-0009)

- Each Built-in Plugin is a folder `src/plugins/<id>/`, built into the same bundle as core and listed in one static registry. Only the entry point reads the registry.
- A Plugin imports only the Plugin API. Core never imports a Plugin. A Plugin uses no Node built-in modules; it works outside its own data only through capabilities of the Plugin API: today its own `plugins/<id>/` folders (`files`) and opening `$EDITOR` (`env.editText`, command mode only). Others are added as Plugins need them; a `git` capability is planned for the Git Plugin (ADR-0016) and does not exist yet. The architecture test enforces these import rules. They are conventions for trusted code, not confinement ([`TRUST.md` §2](plugins/TRUST.md#2-what-the-safeguards-are-and-what-they-are-not)).
- A Plugin's TUI part loads only when the TUI starts. The registry module and every Built-in Plugin's definition module are evaluated on every run, even for Plugins that are off; a throw at the top level of such a module is not contained, and Rowbly does not start.
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

In the TUI, a **Plugins** section in the settings (`,`) does the same. Command mode reads the configuration on every run; the TUI loads its Plugins again each time one is turned on or off there. A Plugin's `start` runs on every load, and there is no teardown.

A Plugin that fails to load is skipped **as a whole**: its settings are invalid, its `start` throws, its commands, options or TUI part fail to attach, one of its names clashes, or this Rowbly version does not have it ([`COMPATIBILITY.md` §2.1](plugins/COMPATIBILITY.md#21-today-internal-and-unreleased)). It keeps none of its names, and its data stays unchanged. Command mode warns once per run on stderr; the TUI warns once per Data Root, Plugin and reason, again only if the failure went away and came back. `rowbly plugins list` shows it as failed with the reason, and `rowbly doctor` reports `PLUGIN_FAILED`. A Plugin refused because it clashed with an earlier one is not retried when that earlier Plugin fails later in the same run, so the result depends only on the registry order and the configuration (ADR-0020 §8). An exact `rowbly --version` loads no Plugins.

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

- **Supplying a required setting.** If a Plugin's settings schema requires a value, `rowbly plugins enable <id>` refuses (`VALIDATION`, exit 2, hint ``fix "plugins.<id>" in rowbly.config.json``) until it is there. Add the value to the Plugin's entry by hand, then run `plugins enable <id>`, or set `"enabled": true` in the same edit.
- **Keep `enabled`** when you edit by hand. Only `plugins enable` and `plugins disable` (or the TUI's Plugins section) should change it; Plugins themselves never change it.
- **Board settings.** A Board changes a Plugin's settings in `board.config.json`, under `"plugins": { "<id>": { … } }`. The Board's bag is deep-merged over the Data Root entry: objects merge key by key, lists and other values replace. `enabled` in a Board bag means nothing: only the Data Root turns a Plugin on or off.
- **When a change takes effect.** Command mode reads the files on every run. The TUI reads the Data Root entry when it loads Plugins (at start, and when one is turned on or off); a Plugin reads Board settings each time it uses them.
- **Checking.** Invalid Data Root settings fail the Plugin's load; `rowbly plugins list` shows the reason and doctor reports `PLUGIN_FAILED`. An invalid Board bag fails the action that reads it with `VALIDATION` naming the Board. A Plugin may declare its settings strict (`z.strictObject`), so a typo fails the load, or lenient, so unknown keys are ignored. Rowbly never rewrites the stored entry.
- **`rowbly plugins show <id>`** prints the stored Data Root entry without `enabled`, as written. It does not show schema defaults or a Board's merged settings.

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
      story.json            # Story bags, and Task bags inside it, e.g. Comments
      plugins/<id>/…        # Story files of a Plugin, e.g. the Story Spec
```

- A bag is `"plugins": { "<id>": { … } }` on a record. Each Plugin validates its own bag. Core keeps every bag unchanged, including the bags of Plugins that are off or unknown and bags that do not parse, and `--json` prints records as they are stored, with every bag. A bag that does not parse is never treated as empty: a Plugin shows it as unavailable, and refuses to change it (`DATA_INTEGRITY`, exit 6) until it is repaired or reset ([bags](plugins/API.md#plugin-data-bags)).
- Each Plugin owns the shape of its bags and files. Unversioned built-in bags are legacy v1; a format change and any migration follow [`plugins/COMPATIBILITY.md`](plugins/COMPATIBILITY.md) (ADR-0021): never automatic, never inferred from an unreadable bag.
- Deleting a Story or a Board deletes its Plugin files. `doctor --fix` moves a Story's whole folder when it renumbers the Story. A Story folder without `story.json` still reserves its Story Key.
- A file reached through a symbolic link inside `plugins/<id>/` is refused. A symlinked Data Root is fine.

## Operations (ADR-0012, ADR-0019, ADR-0020)

Every Service Layer operation, from core or from a Plugin, collects a Change Set (each record created, changed or deleted, with before and after) and saves it once at the end. [`OPERATIONS.md`](OPERATIONS.md) lists every operation with its input and result.

- **Order:** the Plugins' input is parsed, then the body (or a declared replacement) fills the Change Set, then every transform, then every guard, then the save, then every reaction.
- **Guard**: sees the final Change Set, read-only, and can refuse the operation: nothing is saved; exit 4 (`CONFLICT`), with `details.canForce` when `--force` would get past it.
- **Transform**: changes the Change Set before the save, through its writer methods only.
- **Replace**: runs instead of the core operation's body. It is an advanced capability; no Built-in Plugin uses one.
- **React**: sees the saved Change Set and acts only outside Rowbly's data. Each reaction has 5 s, then Rowbly warns and goes on; nothing is undone. Command mode waits for reactions; the TUI runs them in the background, in order. A failure warns, and the exit code stays 0. A timeout cannot stop a synchronous loop or detached work ([`TRUST.md` §2](plugins/TRUST.md#2-what-the-safeguards-are-and-what-they-are-not)).
- **Errors** (ADR-0020 §5, which replaces ADR-0012's error rule): an expected error a Plugin throws (`VALIDATION`, `NOT_FOUND`, `CONFLICT`, `USAGE`, `DATA_INTEGRITY`) keeps its code and exit code; anything else becomes `INTERNAL` (exit 1) with a hint to turn the Plugin off. Both carry `details.plugin`, `details.stage` and, inside an operation, `details.operation`. A failure before the save saves nothing. A row failure only warns; a filter failure fails the list.
- **Stages.** Hooks see frozen copies and change data only through the Change Set they receive; a writer stops working when its hook returns. A hook cannot start another operation: that fails before anything is read or saved. The stage table is in the [reference](plugins/API.md#stages-and-capabilities).
- **One save, coordinated.** Every service call holds the Data Root lock from its first read. An operation keeps it through its checks and the commit, and gives it up before its reactions. The commit goes through a journal, so after a crash the next Rowbly command restores the whole old state or completes the whole new state. See [Saving an operation](ARCHITECTURE.md#saving-an-operation).
- **Results** returned to callers and reactions are the final records, after the transforms. A transform that deletes the record the operation returns fails the operation with `CONFLICT`.
- Plugin input reaches an operation as `plugins: { <id>: … }` in the operation's input. A Plugin's CLI options and TUI form fields fill it, and its `inputs` schema checks it before anything runs.
- Doctor fixes are operations too.

## Names and clashes

- A Plugin's commands are under one top-level command named after its id, for example `rowbly epics …`. A Plugin may also add options to the core commands in `PLUGIN_OPTION_COMMANDS`; Stages, Custom Fields, context and doctor are hookable but take no Plugin options.
- Option flags are long and lower-kebab-case. `--x` and `--no-x` may pair; any other repeated flag or spelling of one attribute fails the load. Both polarities of the global options (`--root`, `--json`, `--yes`, `--prompt`, `--version`, `--help`) are reserved.
- A clash that is not a declared replacement, such as a flag, a key or a name that core or an earlier Plugin already uses, makes the later Plugin fail to load. So do a `replaces` key that is not a core operation, a hook key in a core namespace (`context`, `assignees`, `boards`, `stages`, `fields`, `stories`, `tasks`, `plugins`, `doctor`) that is not a core operation, a `home` or `settings` link to a missing screen, and two Story tabs, Task tabs or settings sections of one Plugin with the same label. Hooks on another Plugin's operations (`<plugin>.<op>`) are not checked.

## Surfaces

Every data change a Plugin offers works in both the CLI and the TUI.

Slots that Plugins can add to now: commands, options on core commands, screens, home menu entries, settings sections, Story form fields, Story filters (the Stories list and the board), Story and Task detail tabs and rows, Board detail sections, `stories show` and `tasks show` rows, and Actions. Board card lines, `stories list` columns and the other closed lists open when a Plugin first needs them.

**Actions** (ADR-0017) are TUI only. An Action names a target (a Board, a Story, a Task, or nothing) and shows wherever that target is in focus, in the footer and the help, and as a button in the header. A Task Action gets the Task and its Story. A data change made by an Action must also be a Plugin command or a Plugin option on a core command.

**Containment in the TUI.** A Plugin screen, tab or section that throws while rendering shows a fallback naming the Plugin in its place; the rest of the TUI keeps working, and the Plugin is tried again when the Plugins load again. A Plugin whose form or filter fields fail contributes nothing to that form or filter, and the screen says so.

## Doctor

- A Plugin that is on adds checks and fixes for its own files and bags, with codes prefixed by its id, such as `EPICS_MISSING_EPIC`. A local code is uppercase words joined by `_`, and must not form a core code; otherwise the finding becomes `PLUGIN_FAILED`. Rowbly adds `details.plugin`, and its value wins.
- Checks run in the `doctor-check` stage, read-only, and see only Stories stored at their own key's folder; duplicate Story Keys are checked after they are renumbered. `DoctorData.local` is the Local State. Fixes run in the `doctor-fix` stage, with doctor's Change Set. Errors follow the [error rule](#operations-adr-0012-adr-0019-adr-0020).
- `--fix` repairs in passes: structural repairs (duplicate Story Keys) first, then a fresh check, then the other fixes, at most 5 passes. Each pass is planned and saved under the Data Root lock. A failed pass saves nothing, and its error lists the passes that did save (`details.committed`).
- `PLUGIN_FAILED` (error): a Plugin that is on failed to load.
- The files and bags of a Plugin that is off or unknown are not checked; doctor reports them once, as info.

## Upgrading from before Plugins

Rowbly has no importer. Data from a Rowbly before ADR-0008 and ADR-0018 (top-level Comments on Stories and Tasks, a Story's `epicId`, and Epic files in `epics/*.json`) is reported by doctor as `LEGACY_DATA` (warning). Doctor never saves those files and never removes the data. Any other change to such a Story drops the old fields, so **commit or back up the Data Root first**, then recreate what you need with the Epics and Comments Plugins.

## Epics

The Epic model from before ADR-0008, as a Built-in Plugin (ADR-0014). Terms: [`src/plugins/epics/CONTEXT.md`](../src/plugins/epics/CONTEXT.md).

- An Epic is `.rowbly/plugins/epics/<epic>.json`: `version`, `id`, `name`, `description`, `closed`, `createdAt`, `updatedAt`.
- A Story's Epic uses the decided bag key `plugins.epics.epic`, for example `"plugins": { "epics": { "epic": "auth" } }`.

```text
rowbly epics list [--closed|--all]                 # open Epics by default
rowbly epics create <id> --name <name> [description flags]
rowbly epics show <id>                             # with its Stories, grouped by Board, and Epic Progress
rowbly epics edit <id> [--name <name>] [description flags]   # at least one, or exit 2
rowbly epics close <id>
rowbly epics reopen <id>
rowbly epics delete <id>                           # unlinks its Stories, with a warning
rowbly stories list … [--epic <id> | --no-epic]
rowbly stories create … [--epic <id>]
rowbly stories edit … [--epic <id> | --no-epic]
```

- TUI: an Epics entry in the home menu, the Epic list and Epic detail with Epic Progress, an Epic select in the Story form, an Epic filter, and an Epic row on the Story screen.
- `stories show` has an Epic row.
Description flags are `--description <text>`, `--description-file <path>` (or `-` for stdin) and `--edit`. `stories list --epic <id>` takes an Epic ID (a slug); anything else is exit 2.

- An Epic file that is corrupt or from a newer Rowbly is `DATA_INTEGRITY` (exit 6) with `details.path` and `details.problem`. The Epic list shows it as unavailable, and `epics list` warns about it.
- Doctor: `EPICS_MISSING_EPIC` (warning), for a Story that links to an Epic file that does not exist; `--fix` unlinks it. `EPICS_CONFLICT_MARKERS`, `EPICS_INVALID_JSON`, `EPICS_UNSUPPORTED_VERSION`, `EPICS_SCHEMA_INVALID`, `EPICS_ID_MISMATCH` and `EPICS_UNREADABLE` (errors) report an Epic file that cannot be used; they are never fixed automatically.
- On the Epic screen, `enter` on a Story opens the core Story screen.
- Epic data from before ADR-0008 is not migrated ([Upgrading from before Plugins](#upgrading-from-before-plugins)).

## Specs

Spec documents for Stories and Boards (ADR-0015). Terms: [`src/plugins/specs/CONTEXT.md`](../src/plugins/specs/CONTEXT.md).

- A Board Spec is `boards/<board>/plugins/specs/<slug>.md`. A Story Spec is `boards/<board>/stories/<KEY>/plugins/specs/spec.md`. The first `# ` heading is the title.
- A Story has at most one Story Spec, and its Specs bag links to any number of Board Specs of its own Board, by slug: `"plugins": { "specs": { "specs": ["auth", "api"] } }`.
- Deleting a Board Spec unlinks it from every Story, with a warning. A Board that has Board Specs is not deleted without `--force` (exit 4), even when it has no Stories.

```text
rowbly specs list [--board <id>]                                       # Board Specs
rowbly specs create <slug> --title <title> [--text <text>|--file <path|->|--edit] [--board <id>]
rowbly specs show <slug> [--board <id>]
rowbly specs edit <slug> [--title <title>] [--text <text>|--file <path|->|--edit] [--board <id>]
rowbly specs delete <slug> [--board <id>]                              # confirms; --yes when not interactive
rowbly specs create|show|edit|delete --story <KEY> …                  # the Story Spec of a Story
rowbly stories create … [--spec <slug>…]
rowbly stories edit … [--spec <slug>… | --add-spec <slug>… | --remove-spec <slug>…]
rowbly stories edit … --reset-specs [--spec <slug>…]                    # replaces the stored links, even invalid ones
rowbly stories list … [--spec <slug>…]
```

`--story <KEY>` names a Story Spec, because Story Keys are case-insensitive and `web-1` is also a valid slug.

- Changing the links of a Story whose Specs bag is invalid fails with `DATA_INTEGRITY` (exit 6); `--reset-specs` replaces them, alone or with `--spec`, and cannot be combined with `--add-spec` or `--remove-spec`. A Spec filter never matches a Story whose Specs bag is invalid.
- Deleting a Board Spec and doctor's missing-link fix stamp the Story's `updatedAt`. The Board deletion guard is forceable: in the TUI, a Board blocked only by its Board Specs offers a forced retry after confirmation.
- TUI: a **Spec** tab on the Story screen (the Story Spec, then the Board Specs it links to), a **Specs** multi-choice of the Board's Board Specs in the Story form, a **Specs** entry in the home menu to list, create, edit and delete the Board's Board Specs, a list of Board Specs in the Board detail, and a Spec filter on the Stories list and the board. Specs are edited in the multi-line text box.

## Comments

Comments on Stories and Tasks, moved out of core (ADR-0018). Terms: [`src/plugins/comments/CONTEXT.md`](../src/plugins/comments/CONTEXT.md).

- A Thread is Plugin Data on its Story or Task: `"plugins": { "comments": { "comments": [ … ] } }`. Each Comment is `id` (8 random characters), `author` (Me when Me is in the roster, else `null`), `body`, `createdAt`, `updatedAt`. The bag is removed with the last Comment.
- The operations are `comments.add`, `comments.update` and `comments.remove`, with input `{ target, body }`, `{ target, id, body }` and `{ target, id }`, so other Plugins can hook them. `add` and `update` return the Comment as other Plugins' transforms left it; a transform that removes it fails the operation with `CONFLICT`.
- A body is stored as given; a body that is empty or only whitespace is refused. `--body` is kept exactly; `--body-file`, stdin and `--edit` lose trailing whitespace, as every long-text flag does.
- The author is checked against the roster on each add: Me when Me is in it, else `null`. In a long TUI run Me may have left the roster.
- A Comment change on a Thread that is stored invalid fails with `DATA_INTEGRITY` (exit 6) and saves nothing; repair it by hand, with `rowbly doctor` to find it. `comments list` exits 6 for it, `stories show` and `tasks show` print `Comments: unavailable (invalid)`, and the TUI tab says so.
- Comments from before ADR-0018 (the `comments` arrays on Stories and Tasks) are not migrated ([Upgrading from before Plugins](#upgrading-from-before-plugins)).

```text
rowbly comments list <KEY|TASK-ID>
rowbly comments add <KEY|TASK-ID> [--body <text>|--body-file <path>|--edit]   # --body-file - reads stdin
rowbly comments edit <KEY|TASK-ID> <comment-id> [body flags]
rowbly comments delete <KEY|TASK-ID> <comment-id>   # confirms; --yes when not interactive
```

- TUI: a **Comments** tab on the Story screen and on the Task screen (`c` add, `e` edit, `d` delete), and the Comment form, a multi-line text box.
- `stories show`, `tasks show` and the Details tabs have a Comments row with the count.

## Details decided in the build

- **The Plugin API** is `src/plugin-api/` (types in `src/services/plugins/types.ts`), with `src/plugin-api/tui` for a Plugin's TUI part. A Plugin declares everything up front in one `definePlugin({ … })` object. Its TUI part is a separate module that `tui()` loads. The [reference](plugins/API.md#modules-and-exports) lists the exports.
- **Operation names** are `<service>.<verb>`, listed in [`OPERATIONS.md`](OPERATIONS.md) and `CORE_OPERATION_NAMES`. A Plugin's own operations are `<id>.<name>`, such as `epics.delete` or `comments.add`; the published verbs stay as they are (ADR-0020 §7). `rowbly init` is not an operation: no Plugin can be on before the Data Root exists. The input of each core operation holds the service method's arguments by name, plus `plugins` (`CoreOperations` in the types).
- **A Change Set** lists stored records, each with `before` and `after`: `rootConfig`, `localState`, `board`, `story` and `file` (a Plugin file, as text, by its path in the Data Root). `before: null` is a created record, `after: null` a deleted one. Tasks are in their Story's record, Assignees in the root config. A renumbered Story is one `story` change whose `before` and `after` have different keys; saving it moves the whole Story folder. Deleting a Board lists a `story` change for each of its Stories, then the `board` change. Deleting a Story or Board deletes its folder with its Plugin files; those files are not listed.
- **Handler order**: the replacement (if one is declared) or the core operation fills the Change Set; then every transform, then every guard, each in registry order, so a guard sees the final Change Set; then the save; then every reaction. The record an operation returns is read back from the Change Set, so `stories create --epic auth --json` prints the bag the Epics transform wrote.
- **Clashes** are found when the Plugins load: a Plugin id that is a core command or an earlier Plugin's id, an option that a core command or an earlier Plugin has (by name, ignoring `no-`), an Action key that a core screen uses ([`CORE_KEYS`](../src/tui/keymap.ts)) or an earlier Plugin uses, a second replacement of an operation, or options on a core command that does not take them. Plugin screens, form fields, filter fields and doctor codes are named after the Plugin, so they cannot clash.
- **Doctor codes** of a Plugin are its own codes prefixed by its id in upper case (`MISSING_EPIC` → `EPICS_MISSING_EPIC`). Core adds `PLUGIN_FAILED` (error), `PLUGIN_DATA_INVALID` (warning: a bag of a Plugin that is on does not match its schema) and `PLUGIN_DATA_UNCHECKED` (info: one per Plugin that is off or unknown and has data).
- **`_Avoid_` words**: the language test reads them from the `CONTEXT.md` of each Built-in Plugin in the registry and applies them to that Plugin's source and to its `rowbly <id>` help pages. A missing glossary, one without `_Avoid_` words, or one that `CONTEXT-MAP.md` does not link fails the test with its name. Folders under `src/plugins/` that hold no registered Plugin are not checked. The help test turns every Built-in Plugin on, so Plugin commands and options are checked too.
- **Epics bag key** is decided: `plugins.epics.epic`.
- Specs details decided: the Story bag key is `specs` (an array of Board Spec slugs). `SPECS_MISSING_SPEC` (warning) reports a Story that links to missing Board Specs; `--fix` unlinks them. The Spec filter matches any selected Board Spec.

## Writing a Built-in Plugin

- [`WRITING-A-PLUGIN.md`](WRITING-A-PLUGIN.md) is the tutorial: from a five-line Plugin to an editable field with options, a filter, commands, TUI fields, a screen, a guard, files, doctor and tests, and the checklist for adding a Built-in Plugin.
- [`plugins/API.md`](plugins/API.md) is the reference: exports, contexts, stages, operations, errors, bags, input and options, forms, focus, containment, transactions, replacements, settings, tracing and testing.
- Handler file reads: guards and other hooks read pending files through `changes.readFile`; commands, screens and rows read stored files through `plugin.files` (Epics does both).
- Tests: `src/plugin-api/testing.ts` (`createPluginTestHost`, `validatePluginDefinition`) runs Plugins against a temporary Data Root; the fixture Plugins in `test/plugins/fixtures/` and the tutorial's in `test/docs/fixtures/` are working examples.
