# Plugin API reference

The contracts a Plugin can rely on. The [tutorial](writing-a-plugin.md) builds a Plugin step by step; [the plugin system](README.md) explains the architecture, and [Built-in Plugins](built-in.md) the Plugins that ship with Rowbly. The JSDoc in `src/services/plugins/types.ts` documents each type; this page collects the rules that span several of them. The decisions are in ADR-0019 (locking and commits), ADR-0020 (stages, data and errors) and ADR-0021 (data formats).

Today every Plugin is a Built-in Plugin in this repository ([trust.md](trust.md), [compatibility.md](compatibility.md)). The API is internal and may change with Rowbly.

## Contents

- [Modules and exports](#modules-and-exports)
- [The definition](#the-definition)
- [Contexts](#contexts)
- [Stages and capabilities](#stages-and-capabilities)
- [Operations](#operations)
- [Stored and pending reads](#stored-and-pending-reads)
- [Errors](#errors)
- [Plugin Data: bags](#plugin-data-bags)
- [Plugin input and CLI options](#plugin-input-and-cli-options)
- [Forms](#forms)
- [Screens, focus and Actions](#screens-focus-and-actions)
- [Failure containment](#failure-containment)
- [Transactions and concurrency](#transactions-and-concurrency)
- [Replacements](#replacements)
- [Data formats and migrations](#data-formats-and-migrations)
- [Load, reload and settings](#load-reload-and-settings)
- [Tracing](#tracing)
- [Testing](#testing)
- [Git capability](#git-capability)
- [Supported-format reconciliation](#supported-format-reconciliation)

## Modules and exports

| Module | Imported by | Holds |
| --- | --- | --- |
| `src/plugin-api` | every file of a Plugin | `definePlugin`; `z` (Zod); the errors `UsageError`, `ValidationError`, `NotFoundError`, `ConflictError`, `DataIntegrityError`, `RowblyError`; helpers `isSlug`, `slugFromName`, `parseStoryKey`, `parseRepeatable`, `toTimestamp`; `colors`, `colorByCategory` and `renderTable`; the schemas `SlugSchema`, `StoryKeySchema`, `TimestampSchema`; `withFixedStages`, which puts Backlog and Done around a configured `stages` list; `CORE_OPERATION_NAMES`; the record types (`Story`, `BoardConfig`, `RowblyConfig`, `LocalState`, …); every Plugin type, and the type-only `Command` (Commander) |
| `src/plugin-api/tui` | a Plugin's TUI part only | Ink's `Box`, `Text`, `useInput` and `Key`; React's `useState`, `useEffect`, `useMemo`, `useCallback`, `useRef` and `ReactNode`; the components `Button`, `Form`, `SelectList`, `DetailView`, `Tabs`, `TextInput`, `TextArea`, `MarkdownView`, `ConfirmDialog`, `Loading`, `StageBadge`, `Modal`, `SelectionRow`; the hooks `useAsync`, `useContextMenu`, `useFullScreenEditor`, `useIsActive`, `useKeyHints`, `useKeyCapture`, `useReloadOnReturn`, `useDirty`, `useLayout`; the type `ContextMenuItem`; `FORM_KEYS`, `moveDelta`, `markdownToPlain`; `theme`, `themes`, `stageColors`, `formatDate` |
| `src/plugin-api/testing.ts` | tests only | `createPluginTestHost`, `validatePluginDefinition` ([Testing](#testing)) |

The types a Plugin meets at run time, by where it meets them:

| Where | Types |
| --- | --- |
| The definition | `PluginDefinition`, `PluginInputSchemas`, `PluginBagSchemas`, `OperationHookMap`, `OperationHooks`, `ReplacementMap`, `PluginOptionsMap`, `PluginCommands`, `PluginDoctor`, `PluginAction`, `PluginTui` |
| Hooks | `TransformEvent`, `GuardEvent`, `ReactionEvent`, `ReplacementEvent`, `GuardResult`, `PluginHookContext`, `PluginChangeSet`, `PluginChangeSetView`, `ChangeSetView`, `Change` and its kinds, `DeepReadonly` |
| Commands | `PluginCli`, `PluginCommandEnv`, `PluginContext`, `PluginServices`, `Command` |
| Options | `PluginOption`, `PluginInputOptions`, `PluginFilterOptions`, `PluginOptionValues`, `PluginOptionCommand` |
| TUI | `PluginScreenProps`, `PluginStoryTabProps`, `PluginBoardSectionProps`, `PluginUi`, `PluginLink`, `PluginStoryForm`, `PluginStoryFilter`, `PluginFormField`, `PluginFormValue`, `ActionFocusOf` |
| Doctor | `DoctorData`, `PluginFinding` |
| Git | `PluginGit`, `GitCommitOptions`, `GitOptionsSource`, `GitSyncOptions`, `GitSyncOptionsSource`, `GitSyncStatus` |
| Reconciliation | `PluginReconciler`, `PluginReconciliation`, `PluginMergeSnapshot`, `PluginIdentityMap`, `PluginReplayProjection`, `MergeFile`, `MergeFiles`, `MergeHelpers`, `IdentityRemap`, `RequiredStory`, `RequiredStage` |

Not exported, on purpose: the full `Services`, `OperationRunner` and host wiring (a Plugin gets `PluginServices` or `PluginReadServices`), `PluginError` (the framework's own attribution error), and the TUI's `useToast` (use `ui.toast` and `ui.error`).

## The definition

`definePlugin({ … })` declares everything up front. Only `id`, `name` and `description` are required.

| Key | What it is |
| --- | --- |
| `id` | A slug: the Plugin's command (`rowbly <id>`), bag key and folder name. |
| `settings` | A Zod schema of its entry in `rowbly.config.json` (without `enabled`). See [settings](#load-reload-and-settings). |
| `bags` | Schemas of its bags on Stories and Local State, checked by doctor. |
| `reconcile` | Optional pure supported-format reconciliation during Git import, including while Off; see below. |
| `inputs`, `storyFilterSchema` | Schemas of its input of core operations and of its Story filter ([input](#plugin-input-and-cli-options)). |
| `start({ settings, git, localData })` | Runs each time the Plugin loads. Throwing fails the load. |
| `requiresGit` | When true, enabling the Plugin requires a Git repository containing the Data Root. |
| `react` | A reaction for every saved Operation, including other Plugins’ Operations, with the same event and deadline as a named reaction. Runs before the named reaction. |
| `hooks` | `{ '<operation>': { transform, guard, react } }`. |
| `replaces` | `{ '<core operation>': replacement }` ([replacements](#replacements)). |
| `commands(group, cli)` | Verbs under `rowbly <id>`. |
| `options` | Options on core commands. |
| `filterStories(story, filter, plugin)` | Whether a Story matches the Plugin's filter. |
| `storyRows` | Rows for `stories show` and the TUI Story screen. |
| `doctor.check({ data, plugin })` | Findings about the Plugin's data. |
| `actions` | TUI Actions. |
| `tui()` | Loads the TUI part: `() => import('./tui').then((m) => m.tui)`. |

## Contexts

| Context | Given to | Has |
| --- | --- | --- |
| `PluginReadContext` | every stage | `id`, `settings`, `boardSettings(boardId)`, `inspectBag`, `readBag`, `requireBag`, `writeBag`, `localData()` (own Local State bag), `git`, `files` (stored reads), `me`, `now()`, `newId()` |
| `PluginHookContext` | hooks, bodies, doctor checks and fixes | the above, `services` (`PluginReadServices`: list, get, effective configuration and Board resolution only), `warn` |
| `PluginContext` | commands, screens, tabs, sections, fields, filters, rows, option input, Actions | the above, `services` (`PluginServices`), `operation(name, input, body, options?)`, `warn` |
| `PluginCommandEnv` | `cli.run` actions | `plugin`, `services`, `json`, `print`, `confirm`, `prompt`, `readText`, `editText`, `resolveBoard` |

- `PluginServices` is every core service except `plugins` (no other Plugin's context, no enable or disable), `setup`, and doctor fixes (`doctor.check` stays). It is built at run time with only those methods.
- `editText` opens `$VISUAL`/`$EDITOR` and exists only in command mode.
- `me` is Me, a handle, or `null`: the Data Root's local Me, else global Me from `~/.rowblyrc.json`. Read it when you record it rather than keeping a copy: the TUI can change it during a run.
- `warn` shows a warning after the command, or a toast in the TUI.

## Stages and capabilities

Each Plugin callback runs in a **stage** (ADR-0020 §1):

| Stage | Change Set | Services | May start an operation |
| --- | --- | --- | --- |
| `body` (an operation's body) | writer | read only | no |
| `replacement` | writer, plus `core()` once | read only | no |
| `transform` | writer, for as long as the transform runs | read only | no |
| `guard` | read-only view, plus pending `readFile` | read only | no |
| `commit` | — (Rowbly saves; holds the lock) | — | — |
| `reaction` | read-only view of the saved Change Set | read only, `warn` | no |
| `doctor-check` | — (`DoctorData`) | read only | no |
| `doctor-fix` | writer (doctor's Change Set) | read only | no |
| `command` | — | `PluginServices` | yes |
| `screen` (screens, tabs, sections, Actions), `field` | — | `PluginServices` | yes |
| `filter`, `row`, `option-input` | — | `PluginServices`, reads only | no |

- **Views are frozen copies.** Every record, change and list a hook reads is a detached, deeply frozen copy; assigning to it throws. An update callback (`updateStory(key, fn)`) gets a copy too: one that changes its copy and then throws changes nothing. `before` is always the stored record.
- **Writers live as long as their stage.** A writer used after its stage ended (from a guard, a reaction, a timer or a promise left running), or after the Change Set was sealed for guards, throws `PluginError` and changes nothing. Await every write.
- **No nested operations.** Starting an operation from a stage marked "no", by any route, throws `PluginError` (`INTERNAL`) with `details: { plugin, operation, stage, nested }` before anything is read or saved. Reads stay allowed. Change data through the Change Set the stage receives.
- **Pinned Plugins.** An operation runs the hooks of the Plugins that were on when it started.

These are guards against mistakes, not a sandbox ([`trust.md` §2](trust.md#2-what-the-safeguards-are-and-what-they-are-not)).

## Operations

[Operations](../architecture/operations.md) lists every operation, its input and its result; `test/plugins/operationInventory.test.ts` keeps it in line with the code.

- Core operations are `<service>.<verb>` (`stories.create`, `stages.remove`, `boards.remove`, …; `CORE_OPERATION_NAMES`). A Plugin's own are `<id>.<name>`; `plugin.operation` takes `<name>`, one lower-kebab-case word.
- **Order:** the Plugin input is parsed → the body (or a replacement) → every transform → every guard (each in registry order) → the save → every reaction.
- **Results.** Hooks and callers see an operation's public result. Transforms and guards get `result`, the body's or replacement's result before any transform; for `stories.create`, `result.key` is the new Story. Callers and reactions get the **final** result, read back from the Change Set after the transforms: a created Story includes the bags transforms wrote. A Plugin operation passes `{ result(changes, bodyResult) }` to `plugin.operation` to read its own final record the same way. A transform that deletes the record an operation returns fails the operation with `CONFLICT` before the save.
- **Stage changes.** `stories.update` can change a Stage, as `stories.move` does. A hook about Stage changes compares `before.stage` with `after.stage` in both.
- **Hook names** in a core namespace (`context`, `boards`, `stages`, `fields`, `stories`, `plugins`, `doctor`) must be core operations, or the Plugin fails to load. Hooks on another Plugin's operations (`'epics.create'`) are allowed and untyped.
- **Reactions** have 5 s each. On timeout Rowbly warns and goes on with the next reaction; nothing is undone. The CLI waits for reactions; the TUI runs them in the background, one operation after another. A timeout cannot stop a synchronous loop or detached work. A rejection the reaction did not return is not caught and ends the process: return or await all work.

## Stored and pending reads

| Read | Sees |
| --- | --- |
| `plugin.services.*` (lists and gets) | stored records |
| `plugin.files.read` / `files.list` | stored files |
| `changes.changes`, `changes.story(key)`, `changes.board(id)` | the Change Set as it is when called, including this stage's own writes |
| `changes.updateStory(key, fn)` | the latest version: the Change Set's, else the stored one |
| `changes.readFile(scope, name)` | the pending text: the Change Set's, else the stored file; `null` for none |
| `doctor.check`'s `data` | the records doctor read, and `local` (Local State); only Stories stored at their own key's folder |

A hook that must see what earlier hooks of the same operation did reads through `changes`. File scopes in a Change Set:

- A Board or Story created in the operation can hold files at once. A Story renumbered by doctor takes its files along; `FileChange.path` shows the path the file will be saved at.
- Writing a file of a Story or Board that the same operation deletes fails with `CONFLICT`. Reading it gives `null`, and deleting it does nothing: the whole folder goes.
- `updateStory` cannot change `key` or `boardId` (`VALIDATION`). Putting again a Story or Board that the operation deleted fails with `CONFLICT`.
- A file reached through a symbolic link inside `plugins/<id>/` is refused for reading, writing, listing and deleting.

## Errors

What a Plugin callback throws becomes (ADR-0020 §5):

| Thrown or returned | Result |
| --- | --- |
| `UsageError`, `ValidationError`, `NotFoundError`, `ConflictError`, `DataIntegrityError` | The same code, exit code, message, hint and `details.issues`, plus `details.plugin`, `details.stage` and `details.operation` (when there is one). Rowbly's attribution wins over the Plugin's own details. |
| A guard's `{ reject, hint?, canForce? }` | `CONFLICT` (exit 4) with `details: { plugin, operation, stage: 'guard', canForce? }`. |
| Anything else (`TypeError`, `Error`, a string) | `INTERNAL` (exit 1), "Plugin "<id>" failed in …", with the hint to turn it off; `details.cause` holds a Rowbly error's code. |
| An error from a replacement's `core()` | Unchanged. |

This applies to every callback: hooks, operation bodies, commands, option input, `filterStories`, rows, doctor checks and fixes, TUI field providers, input and filter conversion, summaries, Actions and reactions. Some fail softer:

- A failing **row** only warns; the other rows still show.
- A failing **filter** fails the list, visibly.
- A failing **reaction** only warns; the data is saved and the exit code is 0.
- A failing **doctor fix** aborts its pass, which saves nothing; earlier passes stay saved (`details.committed`).

With `--json`, every error is `{"error":{"code","message","details","hint"?}}` on stderr; stdout holds only results.

## Plugin Data: bags

A bag is `plugins.<id>` on a record. It is one of:

| Kind | Meaning |
| --- | --- |
| absent | the key is not there |
| valid | it parses with the Plugin's schema |
| invalid | it is there but does not parse |
| unsupported | it declares a data version this Rowbly does not know (no bag does yet; [`compatibility.md` §3](compatibility.md#3-plugin-data-formats)) |

| Method | Absent | Valid | Invalid | Use for |
| --- | --- | --- | --- | --- |
| `inspectBag(record, schema)` | `{ kind: 'absent' }` | `{ kind: 'valid', value }` | `{ kind: 'invalid', raw, issues }` | deciding what to show or offer |
| `readBag(record, schema)` | `undefined` | the value | `undefined` | display only |
| `requireBag(record, schema)` | `undefined` | the value | throws `DATA_INTEGRITY` (exit 6) with `details: { plugin, path, issues }` | changing existing data |
| `writeBag(record, bag)` | — | — | — | a copy with the bag set, or removed for `undefined`; other bags kept. Throws for `rowbly.config.json`. |

- A parse failure never means "empty". An unchanged invalid, unknown or other Plugin's bag is kept as it is by every core edit (its meaning, not its JSON formatting).
- `0`, `false`, `''` and `[]` are values like any other: test for `undefined`, never for falsy.
- A change that only touches a Story's bag stamps the Story's `updatedAt`, and only when the bag really changes.
- Validate data from anywhere else yourself, and pass only checked values on. For example a Plugin file:

```ts
const Tally = z.object({ version: z.literal(1), count: z.number().int().min(0) });

/** Reads `plugins/tally/tally.json`; a file that does not parse is an error, never an empty tally. */
async function readTally(plugin: PluginContext): Promise<z.output<typeof Tally> | undefined> {
  const text = await plugin.files.read('dataRoot', 'tally.json');
  if (text === null) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  const parsed = Tally.safeParse(json);
  if (!parsed.success) {
    throw new DataIntegrityError('plugins/tally/tally.json is not valid', {
      details: { path: 'plugins/tally/tally.json', issues: parsed.error.issues },
      hint: 'run `rowbly doctor`',
    });
  }
  return parsed.data;
}
```

## Plugin input and CLI options

A Plugin's input of a core operation is `plugins.<id>` in the operation's input. The CLI options and the TUI form fill it; a service caller may pass it directly.

- `inputs: { '<core operation>': schema }` parses input that was **given**, before the body and every hook. A failure is `VALIDATION` with `details: { plugin, operation, issues }`, and nothing is saved; in the TUI the issues show on the Plugin's fields. Absent input is never parsed. Hooks get the parsed value as `pluginInput`; without a schema it is `unknown`, so check it before use.
- **Convention:** `undefined` changes nothing, `null` clears, a value sets.
- `storyFilterSchema` parses the Story filter (`StoryFilter.plugins.<id>`) once per list, from the CLI, the TUI or a service caller alike. Without one the value reaches `filterStories` unchecked.

**Options on core commands.** The commands that take Plugin options are `PluginOptionCommand` (`stories list|create|edit|move|rank|delete`, `boards create|edit|delete`). `stories list` entries use `filter(values)`; every other entry uses `input(values)` for the command's operation. Stages, Custom Fields, context and doctor are hookable but take no Plugin options.

`values` holds the raw values by Commander attribute name (`--add-spec` → `addSpec`, `--no-epic` → `epic`). Only options that were given have a value:

| Option | Not given | Given |
| --- | --- | --- |
| `--x <v>` | `undefined` | `'v'`; `--x ''` is `''` |
| `--x <v>` with `repeatable: true` | `undefined` | `['a', 'b']` in the order given; commas stay literal |
| `--x [v]` | `undefined` | `'v'`, or `true` without a value |
| `--x` | `undefined` | `true` |
| `--no-x` | `undefined` | `false` (with `--x` too, the last one wins) |

- Flags are long and lower-kebab-case. `--x` and `--no-x` may pair; any other two flags of a Plugin with one attribute name fail the load, as does a flag core or an earlier Plugin uses (both polarities of the global options are reserved).
- A converter that wants `a,b` to mean two values opts in with `parseRepeatable`. Plugin commands collect a repeatable flag with `cli.collect`.

## Forms

`storyForm.fields({ boardId, story, plugin })` gives the Plugin's fields of the Story form; `story` is `null` for a new Story. `input({ values, initialValues, changedFields, story })` turns them into its input of `stories.create` / `stories.update`.

The form calls `input` **only when one of the Plugin's own fields changed**, comparing normalized values: an empty number is `null`, an unset boolean `false`, an unset multi-select `[]`, and a multi-select's order does not count.

| Story | Field | `input` | Result |
| --- | --- | --- | --- |
| new | left empty, or changed back | not called | no bag |
| new | set (also to `0` or `false`) | called | the Plugin's input |
| existing | unchanged | not called | bag kept as stored, invalid or unknown keys included |
| existing | changed to a value | called | the Plugin's input |
| existing | changed to empty | called | the Plugin's explicit clear, e.g. `{ epic: null }` |
| existing, invalid bag (`unavailable`) | kept | not called | bag kept as stored |
| existing, invalid bag (`unavailable`) | reset | called with the field `null` | the Plugin's explicit clear |
| any | `fields` threw | never called | bag kept as stored |

- Field names are unique within the Plugin; a duplicate fails its fields.
- A `select` cycles through `options` only, so "no value" is an option of the Plugin's own whose label cannot be a real value (Epics: `No Epic`). A filter keeps "any" (`All Epics`) apart from "none".
- `storyFilter.fields` / `filter(values)` / `describe(values)` fill the filter of the Stories list and the board. A Plugin whose filter fields fail is left out of the filter, and the screen says so.
- `storyBadges({ story, plugin })` returns short texts, such as `@ada`, shown on the Story in the board's Stages view, its line in the board's list view and its row in the Stories list, in registry order. It runs while the screen renders, so it must be synchronous and cheap: read the Story's bag, not files. Badges only show something, so a Plugin whose `storyBadges` throws shows none.
- `loadStoryBadges({ plugin })` is for badges that need the Plugin's files, such as the Epics Plugin's `◆ <Epic name>`. It reads them once each time the board, the Stories list or a Story detail loads its Stories, so a change shows when the screen reloads, and returns a function from a Story to its badges, shown after the Plugin's `storyBadges` in the same places. The returned function runs while the screen renders, so it reads only what was loaded and the Story. A Plugin whose load or badges throw shows none.

## Screens, focus and Actions

Use the semantic `theme` colours from `src/plugin-api/tui`; `themes` contains both palettes and `stageColors` maps Stage Categories. `formatDate(isoTimestamp)` formats a timestamp in the terminal's local time. Never use named colours, literal hex values or `dimColor` in a Plugin component. `SelectionRow` takes `selected`, `active`, optional `onClick` and children; it supplies the shared selection bar, fill and focus-following scroll.

`Modal` is a content-sized generic task frame (normally 48–72 columns), with `title` as its breadcrumb, `hints` as key hints and `onClose` for the close control. Use it for a local picker or confirmation; a screen opened with `ui.open` already has this frame. A `Modal` rendered inside a Story tab or a screen opened with `ui.open` is drawn as a layer over that frame's body, not where it is rendered, so a scrolling tab never clips it; it keeps the active state and the Plugin's error boundary of the place that rendered it. The hint strip drops later hints when it is too narrow but keeps a last `esc` hint, so put the confirming key first and `esc back` last. Only core opens Story and Settings screen modals: Plugins use generic task modals and do not request `size: 'screen'`. The top layer alone takes input and shows its hints; the underlying Story or Settings takes no keys, shows no hints and remains mounted and returns with its state intact. A `select` or `multiselect` field's `optionLabels` maps a choice to what it shows, such as a Stage's name for its key. A text field's `fillFrom: { field, format }` fills it with `format(text)` of another field when focus leaves that field, such as a slug from a name with `slugFromName`; it fills the field only while it is empty or still holds the text it filled, so a value the person typed is kept. Put the source field first. A `Form` shows its keys (`FORM_KEYS`: `ctrl+s save` first) itself, in the strip of the Modal around it or with the screen's hints, and there `esc` reads `cancel`, as it does around a `ConfirmDialog`; `submitLabel` names what `ctrl+s` does when it does not save (`apply` for a filter); saving uses `ctrl+s` without an in-form Save button. Bounded bodies scroll with Page Up/Down; focused Form fields and selected rows scroll into view.

- **Screens** get `{ params, plugin, ui }`. `ui.open(screen, params)` opens one of the Plugin's screens on top. `params.title` is the breadcrumb (without one, the screen name with a capital letter); `plugin` and `screen` are reserved route params that Rowbly sets and the screen never gets. Params are not checked: validate them, for example with a schema, and show an error instead of using a bad value.
- `ui.openStory(key)` and `ui.openBoard(id)` open core screens; back returns. `ui.back()`, `ui.toast(message, kind?)`, `ui.error(err)`.
- **Story tabs** get `{ story, active, plugin, ui }`; **Board sections** `{ board, plugin, ui }`. Two tabs or settings sections of a Plugin with the same label, or a `home`/`settings` link to a missing screen, fail the load.
- **Plugin Sidebar.** `sidebar: { title, allLabel, items({ plugin }), filter(value), create? }` adds a list beside the Board sidebar, shown and hidden by a header button titled `title` or by `\` ([ADR-0029](../agents/adr/0029-plugin-sidebars-filter-the-board.md)). `items` returns `{ value, label }` entries; it runs in the `field` stage when the sidebar shows and each time a screen opened over the board closes. The first entry is `allLabel`, such as `All Epics`, and clears the pick. Picking an entry (a click, or `{`/`}`) sets this Plugin's board filter (`StoryFilter.plugins.<id>`) to `filter(value)`, run in the `filter` stage, so it must pass `storyFilterSchema` and `filterStories`; a filter the filter form sets for the same Plugin wins. `create` is a link to one of the Plugin's screens, shown as the button at the bottom; a link to a missing screen fails the load. A failing `items` or `filter` is a toast.
- **Board badges.** `cardBadge({ story, stages, plugin })` returns a short text for a Story in the board's Stages view and its line in the board's list view, such as the Tasks Plugin's `✓ 2/5`, or `null` for none. It runs for every Story on the board each time the board renders, so it must be quick and must not read files: use the Story and the Board's effective Stages it is given. A badge that throws shows nothing for that Story.
- **Focus.** `useIsActive()` is false while a dialog is open or another screen is on top. A tab is active only when it is selected: use `useIsActive() && active`. Give one flag (also covering your own modes, e.g. `active && !confirming`) to `useInput`'s `isActive`, `useKeyHints` (pass `[]` when inactive) and `useKeyCapture`.
- **List filters.** `SelectList` reports its filter mode through `onFilteringChange(filtering)`. Pass a stable state setter and disable the screen's shortcuts and hints while filtering, while keeping the list active so it can accept text and finish filtering. The callback reports false when filtering ends or the list unmounts.
- **Context menus.** `SelectList`'s `onContextMenu(item, x, y)` runs on a right click on an item, after highlighting it. Open a menu there with `useContextMenu().open(x, y, items)`: each `ContextMenuItem` has a `label`, an `onSelect()`, the `key` that does the same on the screen and `disabled` for one that does not apply. Offer only what the screen's keys do. The menu runs an item after the renders that opening it caused, so check in `onSelect` that the item is still the one the menu was opened for.
- **Reloading.** `useAsync(fn, deps)` runs again when `deps` change, toasts a failure, and ignores a run that was superseded. Use `useReloadOnReturn(reload, active?)` to reload when the screen or tab is active again, and while it is active, each time the Data Root changes on disk (a command, another Rowbly or an editor); do not put `active` in `useAsync`'s deps. A screen that loads with `useAsync` alone does not follow changes on disk.
- **Actions** are TUI-only keys with a header button: `{ key, label, target, run({ focus, plugin, ui }) }`. An Action shows and runs only where its target is in focus, and `focus` is typed by the target: `board` has the Board, `story` the Story; `none` runs everywhere with whatever is in focus. The key is one character that no core screen (`CORE_KEYS` in [`src/tui/keymap.ts`](../../src/tui/keymap.ts)) and no earlier Plugin uses. An Action only opens or shows something; a data change it offers must also be a command or an option.

```ts
actions: [
  {
    key: 'x',
    label: 'tally Story',
    target: 'story',
    // A `story` Action runs only where a Story is in focus.
    run: ({ focus, ui }) => ui.toast(`${focus.story.key} on Board ${focus.story.boardId}`),
  },
],
```

## Failure containment

| Failure | Effect |
| --- | --- |
| Invalid settings, a throwing `start`, a name clash, a failing `commands()`, option or TUI import | The Plugin is skipped as a whole and keeps none of its names; its data is kept. One warning per run (the TUI warns once per Data Root, Plugin and reason), `rowbly plugins list` shows it as failed, and doctor reports `PLUGIN_FAILED`. A Plugin refused for a clash is not retried when the Plugin it clashed with fails later. |
| An enabled id this Rowbly does not have | Reported the same way; its data is kept. |
| A top-level throw in a Built-in Plugin's module | Not contained: Rowbly does not start. Disabled Built-in Plugin modules are still evaluated. |
| A screen, tab or section throws while rendering | A fallback naming the Plugin shows in its place; it is tried again when the Plugins load again. |
| A callback throws | See [Errors](#errors). |

## Transactions and concurrency

Each operation is coordinated per Data Root and saved through a journal (ADR-0019):

| Phase | Guarantee |
| --- | --- |
| Before the save: a body, hook or check fails or refuses | Nothing is written and no reaction runs. |
| The save, then an I/O failure or the process dies | After recovery, the whole old state or the whole new state. Recovery runs before the next read and is safe to repeat. |
| Concurrent Rowbly operations, in any processes | Run one after another under the Data Root lock; each plans from the latest saved records. No accepted change is lost; Story Keys are distinct. |
| Rowbly reads | Never see half a save. |
| Editors, Git, `cat`, scripts | Do not take the lock and may see intermediate files. Rowbly does not protect against them. |

The guarantee covers the Rowbly process dying, not power loss. Before the save, Rowbly checks the whole Change Set: schemas, parents, stored sources, free destinations and the symlink policy. A Plugin's `updateRootConfig` must keep every `enabled` value.

## Replacements

An advanced, supported capability; no Built-in Plugin uses one (tutorial [step 11](writing-a-plugin.md#11-advanced-replacements)).

- `replaces: { '<core operation>': async ({ input, pluginInput, changes, core, plugin }) => result }`. Only core operations can be replaced, by one Plugin each.
- It runs instead of the body, on the same Change Set as the transforms and guards that follow; the order stays replacement → transforms → guards → save → reactions.
- `core()` runs the core body against that Change Set, at most once (a second call fails the operation and nothing is saved). Its errors pass through unchanged.
- Not calling `core()` is allowed. The replacement's result is the operation's result and must have its shape.

## Data formats and migrations

Each Plugin owns the shape of its bags and files. Built-in bags have no version and are read as legacy v1. A format change, and any migration, follows [compatibility.md](compatibility.md) and ADR-0021: a migration is never automatic, never inferred from an unreadable bag, runs as one operation, and offers a dry run. Rowbly has no migration engine and no importer of data from before Plugins: doctor reports such data as `LEGACY_DATA` ([Upgrading from before Plugins](built-in.md#upgrading-from-before-plugins)).

## Load, reload and settings

Before loading Plugins, the host finishes pending local publication recovery and snapshots root
configuration and Local State together under publication-aware coordination. Command/surface staging
and `start` run after the gate and Data Root lock are released. The `localData` function supplied to
`start` returns a fresh copy of that Plugin's own bag from this startup snapshot; later saves are read
by a subsequent load or the runtime's coordinated capabilities. A publication or transaction recovery
failure stops loading before any Plugin is staged or started. An ordinary Local State snapshot read
failure is raised when a Plugin calls `start.localData`, preserving per-Plugin load isolation.

- Plugins load in registry order when Rowbly starts: each command-mode run, and the TUI at start, each time a Plugin is turned on or off in its **Plugins** section, and each time `rowbly.config.json` changes on disk. `start` runs on every load; there is no teardown, so `start` must be safe to run again.
- `settings` parses the Data Root entry without `enabled`. Without a schema the settings are the raw entry (`Record<string, unknown>`). `z.object` drops unknown keys from the parsed value; `z.strictObject` fails the load on one. The stored entry is never rewritten.
- `boardSettings(boardId)` is the Board's bag deep-merged over the Data Root entry (objects merge, lists replace), parsed again. An invalid Board bag is `VALIDATION` naming the Board.
- Changing settings from code: a Plugin operation with an explicit merge that keeps `enabled` and every other Plugin's entry (`writeBag` refuses the root config):

```ts
/** Saves new Data Root settings, keeping `enabled` and every other Plugin's entry. */
async function saveSettings(plugin: PluginContext, settings: { count: number }): Promise<void> {
  await plugin.operation('configure', {}, (changes) =>
    changes.updateRootConfig((config) => ({
      ...config,
      plugins: { ...config.plugins, tally: { ...settings, enabled: config.plugins?.tally?.enabled } },
    })),
  );
}
```

How a person edits settings is in [Settings](README.md#settings).

## Tracing

`ROWBLY_DEBUG=trace` (alone or in a comma-separated list) records every Plugin callback, commit and operation:

```text
rowbly trace op-4 stories.create transform plugin=points ok 0.3 ms
rowbly trace op-4 stories.create guard plugin=points ok 0.8 ms
rowbly trace op-4 stories.create commit ok changes=story:1 2.9 ms
rowbly trace op-4 stories.create operation ok 5.1 ms
rowbly trace op-5 stories.update operation rejected code=CONFLICT at=guard:points 1.2 ms
```

- Each line has the operation ID, the operation (or, outside one, the stage), the stage, the Plugin, the outcome (`ok`, `failed`, `rejected`, `timeout`), the error code, the place a failed operation names, and for a commit the number of changes of each type.
- Command mode writes each line to stderr as it happens, so `--json` output on stdout still parses. The TUI keeps the last 1,000 lines and writes them to stderr when it exits.
- It never records inputs, bags, settings, records, file text, error messages or editor text. When it is off nothing is measured or kept.

## Testing

`src/plugin-api/testing.ts` is the test harness; tests import it, Plugins and production code never do. It is internal until Plugin packages exist.

- `createPluginTestHost({ plugins, settings?, boards?, now?, newId?, me? })` creates a Data Root under the system temp folder (Board `web` unless `boards` is given), turns `plugins` on with `settings`, and loads them as Rowbly does, with a fixed clock (`2026-01-01T00:00:00.000Z`) and ids `id000001`, `id000002`, …. It returns `root`, `services` (every core service, for the test only), `warnings`, `status()`, `context(id)` (what the Plugin's own code gets) and `dispose()`.
- `validatePluginDefinition(definition)` lists what loading would refuse; empty when it is fine.
- For a TUI part, render one component with `ink-testing-library`, `host.context(id)` and a recording `PluginUi`, and wait for its loaded data before pressing keys (the recipe is in the module header).
- `pnpm bench:plugins` runs the opt-in performance measurements ([`test/performance/README.md`](../../test/performance/README.md)).

## Git capability

`PluginGit`, `GitCommitOptions` and `GitOptionsSource` are exported by the Plugin API. `git.info()` returns `{ root, authorName, authorEmail }` using the canonical Data Root's containing repository, independent of the caller's directory. Missing Git or no containing repository raises `VALIDATION` with a useful hint. Effective Git configuration supplies the author defaults.

`git.changed(changes, options)` persists paths from a saved `ChangeSetView` and queues due work or schedules an interval. `git.resume(options)` queues persisted work and warns on failure. Their promises resolve after enqueueing, before a commit finishes. Options contain `frequency` (`change` or `interval`), `intervalSeconds`, and optional `authorName`/`authorEmail` and `automaticCommits` (omitted means `true` for legacy callers and pending files).

Both methods also accept a synchronous options resolver `(localData: unknown) => GitCommitOptions` instead of a plain options object. The host reads the owning Plugin's current Local State bag and calls the resolver under the Data Root lock, both when scheduling and before admitting each worker job. The resolver must derive its result from that bag, without effects or captured preference values. The capability retains the resolver for its timers and workers; Built-in Git uses this form. Plain options objects remain supported and workers use their persisted pending options.

With `automaticCommits: false`, both methods retain pending work and `changed` still adds affected paths, but no timer or commit is started. Passing `true` resumes at the selected frequency, retaining the first-pending deadline (adjusted by interval edits).

Local State-only changes add no paths. Queue updates and file snapshots serialize with Data Root writes, and workers check that the owning Plugin is still enabled before admitting each job. With a live resolver, they also refresh pending options, adjust the deadline once for any interval change and increment the revision under that lock before deciding whether to pause. Thus a saved Off preference takes effect even before its reaction publishes a queue update; delayed startup and reactions cannot overwrite it with earlier preferences. Timer decisions use the same coordinated options. Admission under this lock marks a job as running. A commit already running may finish; revision acknowledgement retains later edits. Git processes run under a separate queue lock outside the Data Root lock. These effect methods are intended for `start` and reactions; commands and screens change personal preferences through an Operation. There is no arbitrary Git command or filesystem capability.

Git executes argument arrays without a shell, with a 3.5 s limit per process and 1 MiB output bound. Automatic commits select affected paths, preserve unrelated staging, refuse already-staged affected paths, suppress hooks and signing, and exclude Local State and internal files. Pending paths/deadlines live under Git's own directory. Command-mode Operations and the CLI await due queue work outside reaction deadlines; the TUI does not. Timers do not keep command mode alive; a later load resumes due work. There is no cancellation or flush of future interval work on exit. See [Git](built-in.md#git) for the user contract and ADR-0030 for queue ownership.

## Supported-format reconciliation

ADR-0034 §3 permits one optional synchronous `reconcile` callback during an isolated Git import.
It receives frozen BASE/left/right snapshots of only its own raw bags and scoped files, core
source-qualified Board/Story remaps, retained Story Keys, effective Stage Keys by Board and
deterministic merge/evidence helpers.
During core replay transport, `baseRemap` optionally names BASE's prior core correspondence; the
side `remaps` include prior core transport as well as this reconciliation's changes. Owners rewrite
only references their supported format understands.
Files hold exact base64 bytes and Git modes; `helpers.read` requires lossless UTF-8 and
`helpers.file` encodes supported text. Missing bags are `undefined`, distinct from JSON null.
`helpers.value` recursively combines structurally safe object edits and retains ambiguous leaves; it
does not infer text or set semantics from field names. Only an owning supported format selects
`text` for its text fields and `members` for its sets. `same` compares raw values and `retain` records
explicit alternatives and repairs.
No Plugin context, services, filesystem or Git capability is passed. Normal activation and hooks stay
Off. Unsupported, invalid or future formats must return no override and remain opaque; never parse
through a schema that drops unknown keys and then save its stripped output.

The result has `bags` keyed by existing core scope paths (empty for the Data Root,
`boards/<id>`, `boards/<id>/stories/<key>`) and `files` keyed by owned paths relative to the Data Root.
Omitted entries keep the host's opaque reconciliation. An explicit undefined bag removes that bag.
Output cannot write another Plugin, invent a scope, escape a scoped folder or change core fields.
A thrown error or invalid output stops preparation before live publication.

For replay, the optional `replay` input carries `base`, `left` and `right` identity maps for this
owner only. Each map is keyed by core scope, then by the owner's original string identifier, with
the transported string identifier as its value. The owner checks raw supported-source validity
before applying these maps simultaneously to BASE and the corresponding side. It must preserve
unsupported bags unchanged. Core never interprets an owner's identifiers or infers references.
An owner that splits an identity may return `identities: [{ source, scope, from, to }]`, naming a
supplied side's source and retained core scope. The host bounds and validates these changes and
returns them only to that same owner in later replay steps. These transient maps are not persisted
Plugin Data or a migration API. Merge callers omit replay input and retain their existing behavior.
`from` always names the raw supplied source identifier; `to` names the final output identifier.
Include earlier transported identifiers as well as newly split identifiers. Apply one simultaneous
map for a source, never a chain of substitutions. A new original identifier that equals an earlier
transport destination allocates separately, preserving both records.
Identifiers remain opaque, including `constructor` and `__proto__`. Build, copy and read maps with
own-key semantics; do not treat inherited object properties as entries or restrict valid identifiers.

Replay may additionally return `removedFiles: readonly string[]` to remove exact owned paths from
the immutable candidate. Nonempty removals without replay input are refused. The host requires an
array of at most 4096 unique normalized relative strings, each in this Plugin's scoped folders and
present in at least one supplied own snapshot. Empty segments, traversal, backslashes, NUL, core or
another Plugin's paths, and overlap with `result.files` are refused. Merge Evidence remains append-only.
This grants no live filesystem authority. For identity transport, return only recognized moved source
paths absent from the final projected snapshot; never remove opaque, future or invalid files. Return
a surviving old-path identity explicitly in `files`, without removing its path. The owner alone
recognizes formats: Specs requires lossless UTF-8 before transporting Markdown and safely refuses an
unrecognized binary Markdown source. Ordinary merge callers omit replay and retain omission behavior.

Only a supported format that understands a retained Story reference may additionally return
`requiredStories: [{ source, key }]`. Each request must name an existing Story in an immutable
supplied side snapshot. The host validates the source and key, applies the source-qualified identity
map, and restores that exact complete Story subtree and required Board subtree with evidence.
Restoration is monotone and idempotent over the finite supplied identities; reruns are bounded by
that set. Invalid requests or nonconvergence fail before publication. The analogous optional
`requiredStages: [{ source, board, key }]` names an effective source Stage actually referenced by
retained own data. The host validates the immutable source Board's effective definitions, maps its
Board identity and restores into that merged Board's effective configuration level without flattening
the Configuration Cascade or replacing unrelated definitions. Backlog and Done remain fixed. The
monotone rerun bound includes the finite supplied Stories and effective Stage definitions. These are
narrow restoration requests, with no arbitrary core writer or generic dependency language. Never infer references by
matching strings in unknown data.

Synchronization uses this pure layer to validate its complete isolated candidate before local publication.

```ts
export const mergeNotes = definePlugin({
  id: 'merge-notes',
  name: 'Merge Notes',
  description: 'Notes with a supported reconciliation format',
  reconcile({ base, left, right, helpers }) {
    const bags: Record<string, unknown> = {};
    const schema = z.strictObject({ version: z.literal(1), note: z.string() });
    for (const scope of new Set([...Object.keys(left.bags), ...Object.keys(right.bags)])) {
      const raw = [base.bags[scope], left.bags[scope], right.bags[scope]];
      if (raw.some((value) => value !== undefined && !schema.safeParse(value).success)) continue;
      bags[scope] = helpers.value(raw[0], raw[1], raw[2], `${scope}/merge-notes`);
    }
    return {
      bags,
      files: {},
      requiredStories: [] as RequiredStory[],
      requiredStages: [] as RequiredStage[],
      identities: [],
      removedFiles: [],
    };
  },
});
```

### Synchronization capability

`PluginGit.syncStatus(liveResolver)` reads current preferences and persisted run details, including
the optional scheduled `target` (`branch`, `remote`, `mergeRef`). A stale timer cannot synchronize a
changed branch/upstream in that attempt.
`resumeSync(liveResolver)` schedules persisted work only at start or in a live reaction.
`requestSync(liveResolver)` requests/coalesces an immediate enabled run only from a command/screen
boundary, waits outside Data Root coordination and returns its current result. Its live resolver
returns independent `enabled` and `intervalSeconds`, with optional author name/email. Latest saved
Off prevents admission; an admitted run may finish. The host supplies the registered format owners,
recovers local publication before reads, and owns cleanup. No arbitrary Git argv is exposed.
Synchronization has bounded local/merge/network processes (3.5/10/30 seconds), 16 MiB child output
and a 120-second overall deadline. Unrelated staged/working content remains uncommitted.
