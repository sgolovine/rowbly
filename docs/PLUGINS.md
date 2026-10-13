# Plugins

Rowbly keeps its core small and adds features as Plugins. This page collects the plugin architecture in one place. The terms are in [`CONTEXT.md`](../CONTEXT.md) (Plugin, Built-in Plugin, Plugin Data, Action), and each Plugin has its own glossary, listed in [`CONTEXT-MAP.md`](../CONTEXT-MAP.md). The reasons are in ADR-0009 to ADR-0017.

The plugin system is built: the Plugin API, the registry, loading, the operations pipeline, Plugin Data and Plugin files, the `plugins` commands and settings section, and the slots below. The Epics and Specs Built-in Plugins are not built yet; [Writing a Built-in Plugin](#writing-a-built-in-plugin) is how they will be.

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
- A Story has at most one Story Spec, and its Specs bag links to any number of Board Specs of its own Board, by slug: `"plugins": { "specs": { "specs": ["auth", "api"] } }`.
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

## Details decided in the build

- **The Plugin API** is `src/plugin-api/` (types in `src/services/plugins/types.ts`); see [Writing a Built-in Plugin](#writing-a-built-in-plugin). A Plugin declares everything up front in one `definePlugin({ … })` object. Its TUI part is a separate module that `tui()` loads.
- **Operation names** are `<service>.<method>`: `stories.create`, `stories.update`, `stories.move`, `stories.rank`, `stories.remove`, `tasks.create|update|move|remove`, `comments.add|update|remove`, `boards.create|update|remove`, `assignees.add|update|remove`, `stages.add|update|move|remove`, `fields.add|update|remove`, `context.use|clearUse|setMe`, `plugins.enable|disable` and `doctor.fix` (one per fix pass). A Plugin's own operations are `<id>.<name>`, such as `epics.delete`. `rowbly init` is not an operation: no Plugin can be on before the Data Root exists. The input of each core operation holds the service method's arguments by name, plus `plugins` (`CoreOperations` in the types).
- **A Change Set** lists stored records, each with `before` and `after`: `rootConfig`, `localState`, `board`, `story` and `file` (a Plugin file, as text, by its path in the Data Root). `before: null` is a created record, `after: null` a deleted one. Tasks and Comments are in their Story's record, Assignees in the root config. A renumbered Story is one `story` change whose `before` and `after` have different keys; saving it moves the whole Story folder. Deleting a Board lists a `story` change for each of its Stories, then the `board` change. Deleting a Story or Board deletes its folder with its Plugin files; those files are not listed.
- **Handler order**: the replacement (if one is declared) or the core operation fills the Change Set; then every transform, then every guard, each in registry order, so a guard sees the final Change Set; then the save; then every reaction. The record an operation returns is read back from the Change Set, so `stories create --epic auth --json` prints the bag the Epics transform wrote.
- **Clashes** are found when the Plugins load: a Plugin id that is a core command or an earlier Plugin's id, an option that a core command or an earlier Plugin has (by name, ignoring `no-`), an Action key that a core screen uses (`CORE_KEYS` in `src/tui/keymap.ts`) or an earlier Plugin uses, a second replacement of an operation, or options on a core command that does not take them. Plugin screens, form fields, filter fields and doctor codes are named after the Plugin, so they cannot clash.
- **Doctor codes** of a Plugin are its own codes prefixed by its id in upper case (`MISSING_EPIC` → `EPICS_MISSING_EPIC`). Core adds `PLUGIN_FAILED` (error), `PLUGIN_DATA_INVALID` (warning: a bag of a Plugin that is on does not match its schema) and `PLUGIN_DATA_UNCHECKED` (info: one per Plugin that is off or unknown and has data).
- **`_Avoid_` words**: the language test reads them from each `src/plugins/<id>/CONTEXT.md` and applies them to that Plugin's source and to its `rowbly <id>` help pages. The help test turns every Built-in Plugin on, so Plugin commands and options are checked too.
- Specs details decided: the Story bag key is `specs` (an array of Board Spec slugs). `SPECS_MISSING_SPEC` (warning) reports a Story that links to missing Board Specs; `--fix` unlinks them. The Spec filter matches any selected Board Spec.
- Still open, for the Epics build: the key name inside its bag (such as `epic`).

## Writing a Built-in Plugin

A Built-in Plugin is a folder `src/plugins/<id>/` with a `CONTEXT.md` (its glossary, linked from `CONTEXT-MAP.md`) and an `index.ts` that exports its definition. Add it to `builtInPlugins` in `src/plugins/index.ts`; the order there is the order Plugins run in. Every file of the Plugin imports only `src/plugin-api` (and `src/plugin-api/tui` in its TUI part) and its own files: no Node built-ins and no packages, not even `zod` (use the `z` that the Plugin API exports). The architecture test checks this.

```ts
// src/plugins/epics/index.ts
import { definePlugin, z } from '../../plugin-api';

const StoryBag = z.object({ epic: z.string() });

export const epics = definePlugin({
  id: 'epics',                       // its command, bag key and folder name
  name: 'Epics',
  description: 'Group Stories from any Boards into Epics',
  settings: z.object({}),            // its entry in rowbly.config.json, without `enabled`
  bags: { story: StoryBag },         // checked by doctor; also story, task, comment, assignee, local
  hooks: { /* by operation name: { guard, transform, react } */ },
  options: { /* options on core commands */ },
  commands(group, cli) { /* verbs of `rowbly epics` */ },
  filterStories(story, filter, plugin) { /* StoryFilter.plugins.epics */ },
  storyRows: async (story, plugin) => [],  // rows of `stories show` and the TUI Story screen
  doctor: { check: ({ data, plugin }) => [] },
  actions: [],                       // TUI Actions, by target
  tui: () => import('./tui').then((m) => m.tui),
});
```

Only `id`, `name` and `description` are required. The types are in `src/services/plugins/types.ts`, re-exported by the Plugin API.

### The context

Every handler, command, screen and Action gets a `PluginContext` (as `plugin`):

| Member | What it does |
| --- | --- |
| `settings`, `boardSettings(boardId)` | The Data Root settings, checked by the `settings` schema when the Plugin loaded; a Board's settings are its bag deep-merged over them (lists replace). |
| `readBag(record, schema)`, `writeBag(record, bag)` | This Plugin's bag on any record: parsed (`undefined` when missing or invalid), or a copy of the record with the bag set (`undefined` removes it). |
| `files.read(scope, name)`, `files.list(scope)` | Its files in `plugins/<id>/` at a scope: `'dataRoot'`, `{ board }` or `{ story }`. Writes go through a Change Set. |
| `services` | Every core service. Reads are free; a core operation called here saves on its own, so do not call one from a handler. |
| `operation(name, input, body)` | Runs one of the Plugin's own operations, `<id>.<name>`, through the whole pipeline; `body` fills its Change Set. |
| `editText(initial)` | Opens `$VISUAL`/`$EDITOR` (command mode only). |
| `warn(message)`, `me`, `now()` | A warning after the command or a toast; Me; the clock. |

### Operations and Change Sets

```ts
hooks: {
  'stories.create': {
    // `pluginInput` is this Plugin's part of `input.plugins`, e.g. from `--epic auth`.
    async transform({ changes, pluginInput, plugin }) {
      const created = changes.changes.find((c) => c.type === 'story' && c.before === null);
      if (created?.type !== 'story' || !created.after || pluginInput === undefined) return;
      await changes.updateStory(created.after.key, (story) => plugin.writeBag(story, pluginInput as object));
    },
  },
  'boards.remove': {
    guard: ({ input }) => (input.force ? undefined : { reject: 'the Board has Board Specs', hint: 'pass --force' }),
  },
},
```

- A **transform** changes the Change Set: `putStory`, `updateStory(key, fn)` (the latest version, from the Change Set or disk), `deleteStory`, `putBoard`, `updateBoard`, `updateRootConfig`, `updateLocalState`, and for its own files `readFile`, `writeFile` and `deleteFile`. Every record is checked against its schema when it is put.
- A **guard** returns `{ reject, hint? }` to stop the operation (exit 4), or `undefined`.
- A **reaction** gets the saved Change Set (read-only) and the `result`, and acts only outside Rowbly's data. Its failure only warns.
- A **replacement** (`replaces: { 'tasks.create': async ({ core, changes, input }) => … }`) runs instead of core; `core()` runs core into the same Change Set.
- Anything a guard, transform or replacement throws fails the operation with exit 1 and `details.plugin`. A Plugin's own command may throw `NotFoundError`, `UsageError` and the other errors the Plugin API exports, with their usual exit codes.
- Change data in a transform, never in a reaction, so one user action is one save.

A Plugin's own data change is an operation of its own, so other Plugins can hook it:

```ts
await plugin.operation('delete', { id }, async (changes) => {
  await changes.deleteFile('dataRoot', `${id}.json`);
  for (const story of linked) await changes.updateStory(story.key, (s) => plugin.writeBag(s, undefined));
});
```

### Command mode

```ts
commands(group, cli) {
  group
    .command('show <id>')
    .description('Show an Epic with its Stories')
    .action((id: string, _opts: unknown, cmd) =>
      cli.run(cmd, async ({ plugin, print, json }) => {
        const epic = await plugin.files.read('dataRoot', `${id}.json`);
        if (epic === null) throw new NotFoundError(`Epic "${id}" not found`);
        print(JSON.parse(epic), (e) => e.name);
      }),
    );
},
options: {
  'stories create': {
    options: [{ flags: '--epic <id>', description: 'the Epic of the new Story' }],
    input: ({ epic }) => (epic === undefined ? undefined : { epic }),
  },
  'stories list': {
    options: [{ flags: '--epic <id>', description: 'only Stories of this Epic' }, { flags: '--no-epic', description: 'only Stories without an Epic' }],
    input: ({ epic }) => (epic === undefined ? undefined : epic),   // becomes StoryFilter.plugins.epics
  },
},
filterStories: (story, filter, plugin) => (plugin.readBag(story, StoryBag)?.epic ?? false) === filter,
```

- `group` is the commander command `rowbly <id>`. `cli.run(cmd, action)` gives the action `plugin`, `services`, `json`, `print(data, human)`, `confirm(message)` (needs `--yes` when not interactive), `prompt(value, { flag, message })`, `readText({ text, file, edit }, { name, initial })` and `resolveBoard(flag)`, and prints warnings and errors like core commands. `cli.collect` and `cli.parseRepeatable` handle repeatable flags.
- `options` adds long flags to core commands (`PluginOptionCommand` lists which). `input` turns the parsed values, by commander attribute name, into this Plugin's input of the operation, or its filter for `stories list`; `undefined` means the Plugin's options were not used. Pair `--x <v>` with `--no-x`, since `--no-x` alone makes `x` default to `true`.
- `colors` and `renderTable` from the Plugin API format human output like core.

### TUI

`tui()` returns a `PluginTui`, built from `src/plugin-api/tui` (Ink's `Box`, `Text`, `useInput`, React hooks, and Rowbly's `Form`, `SelectList`, `DetailView`, `Loading`, `useAsync`, `useKeyHints` and others):

| Slot | What a Plugin gives |
| --- | --- |
| `screens` | Components by name, with `{ params, plugin, ui }`. `ui.open(name, params)` opens one; `ui.toast`, `ui.error`, `ui.back`. |
| `home`, `settings` | `{ label, screen, params? }` links in the home menu and the Global settings group. |
| `storyForm` | `fields({ boardId, story, plugin })` and `input(values, story)`: the Plugin's input of `stories.create` / `stories.update`. |
| `storyFilter` | `fields({ boardId, plugin })`, `filter(values)` (passed to `filterStories`) and `describe(values)` for the filter line, on the Stories list and the board. |
| `storyTabs` | `{ label, component }` tabs on the Story screen, with `{ story, active, plugin, ui }`. |
| `boardSections` | Components shown in the Board detail, with `{ board, plugin, ui }`. |

`storyRows` (in the definition) also shows on the Story screen. **Actions** are in the definition, so their keys are checked when the Plugin loads: `{ key, label, target: 'board' | 'story' | 'task' | 'none', run({ focus, plugin, ui }) }`. They show in the footer, the help and as header buttons wherever their target is in focus, and may only open or show something (ADR-0017).

### Tests

Test a Plugin through the services with `loadPlugins` and a registry that holds it, and in command mode through a built CLI; `test/plugins/` does both for the fixture Plugins and is a model.
