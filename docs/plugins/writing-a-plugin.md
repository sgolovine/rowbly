# Writing a Plugin

This guide builds a Plugin step by step: first a row that shows on every Story, then **Points**, an editable Story field with CLI options, a filter, a command, TUI form fields, a screen, a guard, a file, a doctor check and tests. Every TypeScript example on this page is compiled by `pnpm typecheck` and run by `test/docs/tutorial.test.ts` (the sources are in `test/docs/fixtures/`), so the examples work with the current API.

Look up the details in the [Plugin API reference](api.md). The architecture, the Built-in Plugins and the reasons behind them are in [the plugin system](README.md) and [Built-in Plugins](built-in.md). The words used here (Plugin, Built-in Plugin, Plugin Data, Action, Story, Board, Data Root, …) are defined in [`CONTEXT.md`](../agents/CONTEXT.md).

1. [Supported scope and imports](#1-supported-scope-and-imports)
2. [Hello world](#2-hello-world)
3. [Running and turning it on](#3-running-and-turning-it-on)
4. [An editable field](#4-an-editable-field)
5. [Commands](#5-commands)
6. [TUI form fields](#6-tui-form-fields)
7. [Screens](#7-screens)
8. [The operation lifecycle](#8-the-operation-lifecycle)
9. [Files, doctor and settings](#9-files-doctor-and-settings)
10. [Tests](#10-tests)
11. [Advanced: replacements](#11-advanced-replacements)
12. [Checklist for a Built-in Plugin](#12-checklist-for-a-built-in-plugin)

## 1. Supported scope and imports

**Today every Plugin is a Built-in Plugin**: a folder `src/plugins/<id>/` in this repository, built into Rowbly and listed in its registry. Third-party Plugins, Plugin packages and installing a Plugin from outside the repository are not built (see [`compatibility.md`](compatibility.md) and [`trust.md`](trust.md)). Every step below is a repository step.

A Plugin imports only:

- `src/plugin-api` (as `'../../plugin-api'`): `definePlugin`, `z` (Zod), the error classes, the record types and every Plugin type;
- `src/plugin-api/tui` (as `'../../plugin-api/tui'`), only from its TUI part: Ink's `Box`, `Text` and `useInput`, React hooks, and Rowbly's TUI components and hooks;
- its own files.

No Node built-in modules and no packages, not even `zod` directly. `test/architecture.test.ts` checks this. Everything else reaches a Plugin at run time through the context (`plugin`) that its hooks, commands, screens and Actions receive.

Built-in Plugins are trusted code. The capabilities, frozen views and timeouts described below guard against mistakes; they are not a sandbox ([`trust.md` §2](trust.md#2-what-the-safeguards-are-and-what-they-are-not)).

## 2. Hello world

A Plugin that adds a row to every Story:

```ts
import { definePlugin } from '../../plugin-api';
export const hello = definePlugin({
  id: 'hello', name: 'Hello', description: 'Shows the Story Key',
  storyRows: async (story) => [{ label: 'Hello', value: story.key }],
});
```

Only `id`, `name` and `description` are required. `id` is a slug: it is also the Plugin's command (`rowbly hello`), its bag key and its folder name. `storyRows` is called for `rowbly stories show` and for the TUI Story screen; it receives the Story and the Plugin's context, and returns labelled values.

## 3. Running and turning it on

1. Save the file as `src/plugins/hello/index.ts`.
2. Add `hello` to `builtInPlugins` in `src/plugins/index.ts`. The order of that list is the order Plugins run in.
3. Add a glossary, `src/plugins/hello/CONTEXT.md`, and link it from [`CONTEXT-MAP.md`](../agents/CONTEXT-MAP.md) (see the [checklist](#12-checklist-for-a-built-in-plugin)).
4. Turn it on for a Data Root and look at a Story:

```text
pnpm dev plugins enable hello
pnpm dev stories show WEB-1     # … Hello: WEB-1
pnpm dev                        # the TUI: open the Story; its details show the Hello row
```

A Plugin is off until its entry in `rowbly.config.json` has `"enabled": true`; `plugins enable` writes that. `rowbly plugins list` shows every Built-in Plugin and whether it is on, off or failed. Command mode reads the configuration on every run. The TUI loads Plugins when it starts and again when you turn one on or off in its **Plugins** settings section.

## 4. An editable field

Points keeps a number on each Story, settable from `stories create` and `stories edit`, filterable in `stories list`, and shown as a row. Keep the schemas and small readers in their own file:

```ts
import { type PluginReadContext, type Story, z } from '../../plugin-api';

/** The settings: `"points": { "enabled": true, "label": "Estimate", "max": 8 }`. A Board may change `max`. */
export const PointsSettings = z.strictObject({
  label: z.string().default('Points'),
  max: z.number().int().positive().default(13),
});
export type PointsSettings = z.output<typeof PointsSettings>;

/** The bag on a Story: `"plugins": { "points": { "points": 3 } }`. */
export const PointsBag = z.object({ points: z.number().int().min(0) });

/** The input of `stories.create` and `stories.update`: a number sets the points, `null` clears them. */
export const PointsInput = z.object({ points: z.number().int().min(0).nullable() });
export type PointsInput = z.output<typeof PointsInput>;

/** A Story's points, or `undefined` when it has none. Tolerant (`readBag`): for display only. */
export function storyPoints(plugin: PluginReadContext<PointsSettings>, story: Story): number | undefined {
  return plugin.readBag(story, PointsBag)?.points;
}
```

- **The bag** is the Plugin's Plugin Data on a record: `"plugins": { "points": { "points": 3 } }`. `bags: { story: PointsBag }` lets `rowbly doctor` report a Story whose bag does not match (`PLUGIN_DATA_INVALID`).
- **`readBag`** is tolerant and for display: it returns `undefined` when the bag is absent *or* invalid. Code that changes existing data reads it with **`requireBag`**, which throws `DATA_INTEGRITY` for an invalid bag, so a change never overwrites data it could not read. **`inspectBag`** tells the three apart (`absent`, `valid`, `invalid`). Points replaces its whole bag on every change, so it does not need the old value.
- **Settings** are the Plugin's entry in `rowbly.config.json`, without `enabled`. `z.strictObject` fails the load on a typo; `z.object` would drop unknown keys from the parsed settings. Without a `settings` schema the settings are the raw entry, unchecked. The stored entry is never rewritten.

The definition declares the schemas:

```ts
import {
  definePlugin,
  type GuardResult,
  type PluginChangeSet,
  type PluginChangeSetView,
  type PluginFinding,
  type PluginReadContext,
  type Story,
  z,
} from '../../plugin-api';
import { commands } from './commands';
import { PointsBag, PointsInput, PointsSettings, storyPoints } from './model';

/** A CLI value as points. Text that is not a number becomes `NaN`, which the input schema rejects. */
function toPoints(value: string | readonly string[] | boolean): number {
  return typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
}

export const points = definePlugin({
  id: 'points',
  name: 'Points',
  description: 'Story points for estimates',
  settings: PointsSettings,
  bags: { story: PointsBag },
  inputs: { 'stories.create': PointsInput, 'stories.update': PointsInput },
  storyFilterSchema: z.number().int().min(0),
```

`inputs` holds a schema for this Plugin's input (`plugins.points`) of each core operation it takes input for. Input that was given is parsed **before** the operation's body and every hook. A failure is `VALIDATION` (exit 2) with `details: { plugin, operation, issues }`, and nothing is saved. `storyFilterSchema` checks the Plugin's Story filter in the same way, once per list. Both types flow into the hooks, the option converters and `filterStories`, so no casts are needed.

The hooks apply the input to the Story:

```ts
hooks: {
  'stories.create': {
    transform: ({ changes, result, pluginInput, plugin }) => apply(changes, result.key, pluginInput, plugin),
    guard: ({ changes, plugin }) => aboveMax(changes, plugin),
  },
  'stories.update': {
    transform: ({ changes, input, pluginInput, plugin }) => apply(changes, input.key, pluginInput, plugin),
    guard: ({ changes, plugin }) => aboveMax(changes, plugin),
  },
},
```

```ts
/** Applies this Plugin's input to Story `key`: `undefined` changes nothing, `null` clears, a number sets. */
async function apply(
  changes: PluginChangeSet,
  key: string,
  input: PointsInput | undefined,
  plugin: PluginReadContext<PointsSettings>,
): Promise<void> {
  if (input === undefined) return;
  const { points } = input;
  await changes.updateStory(key, (story) => plugin.writeBag(story, points === null ? undefined : { points }));
}
```

- A **transform** changes the Change Set before it is saved, through writer methods only (`updateStory`, `putStory`, `writeFile`, …). `writeBag` returns a copy of the record with the bag set, or removed for `undefined`, and keeps other Plugins' bags.
- `pluginInput` is the **parsed** input, or `undefined` when none was given. The convention for every Plugin: **`undefined` changes nothing, `null` clears, a value sets.** So a `stories edit` that does not mention points keeps them, and `0` is a value like any other.
- For `stories.create`, `result.key` is the created Story. For `stories.update`, `input.key` is the Story being changed.
- `await` every write before the hook returns: the writer stops working when its stage ends.

The CLI options fill that input, and the filter and row read the bag:

```ts
options: {
  'stories create': {
    options: [{ flags: '--points <n>', description: 'the Story points' }],
    input: ({ points }) => (points === undefined ? undefined : { points: toPoints(points) }),
  },
  'stories edit': {
    options: [
      { flags: '--points <n>', description: 'set the Story points' },
      { flags: '--no-points', description: 'remove the Story points' },
    ],
    input: ({ points }) =>
      points === undefined ? undefined : { points: points === false ? null : toPoints(points) },
  },
  'stories list': {
    options: [{ flags: '--points <n>', description: 'only Stories with these points' }],
    filter: ({ points }) => (points === undefined ? undefined : toPoints(points)),
  },
},
filterStories: (story, filter, plugin) => storyPoints(plugin, story) === filter,
async storyRows(story, plugin) {
  const value = storyPoints(plugin, story);
  return value === undefined ? [] : [{ label: plugin.settings.label, value: String(value) }];
},
```

Each option converter gets the option values by Commander attribute name. Only options that were given have a value:

| On the command line | Value |
| --- | --- |
| (option not given) | `undefined` |
| `--points 3` | `'3'` (a string; the converter turns it into a number) |
| `--points ''` | `''` |
| `--no-points` (paired with `--points <n>`) | `false` |
| `--points 3 --no-points` | the last one wins: `false` |
| a `repeatable: true` option given twice | `['a', 'b']`, in order; commas stay literal |
| `--add-spec x` | the attribute is `addSpec` |

`stories list` options use `filter(values)`, which returns the Plugin's Story filter; every other command uses `input(values)`, which returns the Plugin's input of the command's operation. Either returns `undefined` when the Plugin's options were not used.

```text
rowbly stories create --name Login --points 0
rowbly stories edit WEB-1 --points 5
rowbly stories edit WEB-1 --no-points          # clears
rowbly stories edit WEB-1 --points many        # exit 2: VALIDATION, nothing saved
rowbly stories list --points 5
```

## 5. Commands

A Plugin's commands are verbs under `rowbly <id>`. Keep them in their own module:

```ts
import { type PluginCommands, renderTable } from '../../plugin-api';
import { type PointsSettings, storyPoints } from './model';

export const commands: PluginCommands<PointsSettings> = (group, cli) => {
  group
    .command('total')
    .description('Add up the points of a Board')
    .option('--board <id>', 'the Board; defaults to the current Board')
    .action((opts: { board?: string }, cmd) =>
      cli.run(cmd, async ({ plugin, services, print, resolveBoard }) => {
        const board = await resolveBoard(opts.board);
        const stories = await services.stories.list(board, {});
        const counted = stories.flatMap((story) => {
          const points = storyPoints(plugin, story);
          return points === undefined ? [] : [{ key: story.key, points }];
        });
        const total = counted.reduce((sum, story) => sum + story.points, 0);
        print({ board, stories: counted, total }, (t) =>
          [
            renderTable(
              ['Story', plugin.settings.label],
              t.stories.map((s) => [s.key, String(s.points)]),
            ),
            `Total: ${t.total}`,
          ].join('\n'),
        );
      }),
    );
```

Wire them up with `commands` in the definition ([step 9](#9-files-doctor-and-settings) shows the rest of the definition). `cli.run(cmd, action)` runs the action with the Plugin's context and:

- `services`: the core services without `plugins` and `setup`, and doctor only for `check`. A core operation called from a command saves on its own;
- `print(data, human)`: JSON with `--json`, else `human(data)`;
- `confirm`, `prompt`, `readText` (exactly one of `--<name>`, `--<name>-file <path|->` and `--edit`), `editText` and `resolveBoard` (`--board`, then `ROWBLY_BOARD`, then the current Board).

It prints warnings, and turns errors into exit codes like core commands do. Throw the errors the Plugin API exports (`UsageError`, `ValidationError`, `NotFoundError`, `ConflictError`, `DataIntegrityError`) for an expected failure: they keep their code and exit code, and gain `details.plugin` and `details.stage`. Anything else becomes `INTERNAL` (exit 1) with a hint to turn the Plugin off.

`cli.collect` collects a repeatable flag of a Plugin command; `parseRepeatable` turns `['a,b', 'c']` into `['a', 'b', 'c']` when a converter wants commas to separate values. Options on core commands use `repeatable: true` instead.

## 6. TUI form fields

A Plugin's TUI part is a separate module that only the TUI loads, so command mode never loads Ink or React:

```ts
import type { PluginTui } from '../../plugin-api';
import { PointsBag, type PointsSettings, storyPoints } from './model';
import { PointsScreen } from './PointsScreen';

export const tui: PluginTui<PointsSettings> = {
```

Form and filter fields are plain values; no React component is needed:

```ts
storyForm: {
  async fields({ story, plugin }) {
    // An invalid stored bag is shown as unavailable and kept unless the person resets it.
    if (story && plugin.inspectBag(story, PointsBag).kind === 'invalid') {
      return [
        {
          name: 'points',
          label: plugin.settings.label,
          kind: 'number',
          unavailable: 'stored value is invalid; kept unchanged',
        },
      ];
    }
    const value = story ? (storyPoints(plugin, story) ?? null) : null;
    return [{ name: 'points', label: plugin.settings.label, kind: 'number', value }];
  },
  // Called only when the field changed. An empty number is `null`: the explicit clear.
  input({ values, story }) {
    if (typeof values.points === 'number') return { points: values.points };
    return story ? { points: null } : undefined;
  },
},
storyFilter: {
  async fields({ plugin }) {
    return [{ name: 'points', label: plugin.settings.label, kind: 'number' }];
  },
  filter: (values) => (typeof values.points === 'number' ? values.points : undefined),
  describe: (values) => (typeof values.points === 'number' ? `${values.points} points` : ''),
},
```

- `storyForm.fields` gives the Story form's fields, for a new Story (`story: null`) and for an existing one. `input` turns the values into the Plugin's input of `stories.create` / `stories.update`.
- **The form calls `input` only when one of the Plugin's own fields changed.** An unchanged field, or fields that failed to load, never produce input, so they never change stored data. An empty number field is `null`; a cleared field on an existing Story is the explicit clear. Points returns `{ points: null }`, and keeps `0`.
- A field with `unavailable` shows that text instead of the stored value and offers only a reset. Use it for an invalid bag: the stored value is kept unless the person resets it.
- `storyFilter` adds fields to the filter of the Stories list and the board: `filter` gives the value for `filterStories`, and `describe` the text of the filter line.

The whole contract, with its truth table, is in the reference under [Forms](api.md#forms).

## 7. Screens

A screen is a React component that gets `{ params, plugin, ui }`:

```tsx
import type { PluginScreenProps } from '../../plugin-api';
import {
  Box,
  Loading,
  SelectList,
  Text,
  useAsync,
  useIsActive,
  useKeyHints,
  useReloadOnReturn,
} from '../../plugin-api/tui';
import { type PointsSettings, storyPoints } from './model';

/** Every Story that has points, on every Board; `enter` opens the Story. */
export function PointsScreen({ plugin, ui }: PluginScreenProps<PointsSettings>) {
  const active = useIsActive();
  const data = useAsync(async () => {
    const stories = await plugin.services.stories.list(null, {});
    return stories.flatMap((story) => {
      const points = storyPoints(plugin, story);
      return points === undefined ? [] : [{ story, points }];
    });
  }, [plugin]);
  // Back from a Story shows what changed there.
  useReloadOnReturn(data.reload);
  useKeyHints(active ? [{ key: 'enter', description: 'open Story' }] : []);
  if (!data.data) {
    return data.loading ? <Loading label="Loading Stories…" /> : <Text color="red">Could not load Stories.</Text>;
  }
  return (
    <Box flexDirection="column">
      <Text bold>{`${plugin.settings.label} by Story`}</Text>
      <SelectList
        items={data.data.map(({ story, points }) => ({
          value: story.key,
          label: `${story.key} · ${story.name}`,
          description: `${points} ${plugin.settings.label}`,
        }))}
        emptyText="No Story has points yet."
        isActive={active}
        onSelect={({ value }) => ui.openStory(value)}
      />
    </Box>
  );
}
```

```ts
  screens: { list: PointsScreen },
  home: [{ label: 'Points', screen: 'list' }],
};
```

- `home` adds an entry to the home menu, and `settings` a section to the settings (`,`). Both name a screen of the Plugin, or the Plugin fails to load.
- `ui.open(screen, params)` opens another of the Plugin's screens; `params.title` is its breadcrumb. `ui.openStory`, `ui.openTask` and `ui.openBoard` open core screens; back returns here. `ui.toast` and `ui.error` show messages.
- **Keys and focus.** `useIsActive()` is false while a dialog is open or another screen is on top. Give the same flag to `useInput`, `useKeyHints` and `useKeyCapture`. A Story or Task tab gets an `active` prop as well: use `useIsActive() && active`.
- **Loading.** `useAsync(fn, deps)` runs `fn` again when `deps` change, and shows a failure as a toast. `useReloadOnReturn(reload)` reloads when the screen is on top again, for example after a Story it opened is closed.
- A screen that throws while rendering shows a fallback naming the Plugin; the rest of the TUI keeps working. Errors in event handlers and detached promises are not caught by it: pass them to `ui.error`.

## 8. The operation lifecycle

Every change, from core or from a Plugin, is one **operation** (such as `stories.create`) that fills one Change Set and saves it once:

```text
the Plugin's input is parsed → body (core), or a replacement → transforms → guards → save → reactions
```

- The **body** fills the Change Set. Then every Plugin's **transform** runs, in registry order, and can add to it.
- Then every **guard** sees the final Change Set, read-only, and can refuse the operation. Points refuses a Story whose points are above its Board's `max`, a rule that the input schema cannot check because it depends on the Board:

```ts
/** Refuses a Story whose points are above its Board's `max`, a rule no schema can check alone. */
async function aboveMax(changes: PluginChangeSetView, plugin: PluginReadContext<PointsSettings>): Promise<GuardResult> {
  for (const change of changes.changes) {
    if (change.type !== 'story' || change.after === null) continue;
    const points = plugin.readBag(change.after, PointsBag)?.points;
    const { max } = await plugin.boardSettings(change.after.boardId);
    if (points !== undefined && points > max) {
      return {
        reject: `Story ${change.after.key} has ${points} points; its Board allows at most ${max}`,
        hint: 'use fewer points, or raise "max" in the Board settings',
      };
    }
  }
  return undefined;
}
```

- A refusal is `CONFLICT` (exit 4) with `details: { plugin, operation, stage: 'guard' }`, and nothing is saved. `canForce: true` says that `--force` gets past it, so the TUI can offer a forced retry.
- The **save** is one journaled commit under the Data Root lock: after a crash the Data Root holds the whole old state or the whole new state ([Storage and commits](../architecture/storage.md)).
- **Reactions** (`react`) run after the save with the saved Change Set and the final result. They act only outside Rowbly's data: starting an operation from one fails. Each has 5 s; then Rowbly warns and goes on. A timeout cannot stop a synchronous loop or work the reaction left running, so return or await all of it.

Rules for every hook:

- Hooks see **frozen copies**: change data only through the writer methods of the Change Set they receive.
- A hook may not start another operation, through `services` or a kept command context: it fails with `PluginError` before anything is read or saved. Reads are fine.
- An expected error thrown from a hook (`ValidationError`, `NotFoundError`, …) keeps its code; anything else fails the operation as `INTERNAL`. Either way nothing is saved.
- Hooks are typed for core operations; a hook on another Plugin's operation (`'epics.create'`) is allowed and untyped. A hook on a name in a core namespace that is not a core operation (`'stories.edit'`) fails the load.
- Do not rely on the operation name alone for Stage changes: `stories.update` and `tasks.update` can change a Stage too. Compare `change.before.stage` and `change.after.stage`.

The operations, their inputs and their results are listed in [Operations](../architecture/operations.md).

## 9. Files, doctor and settings

The rest of the definition:

```ts
  commands,
  doctor: { check: ({ data, plugin }) => checkPoints(data.stories, plugin) },
  tui: () => import('./tui').then((m) => m.tui),
});
```

**Files.** A Plugin may keep files in its own `plugins/<id>/` folder of the Data Root, a Board or a Story. Points keeps a note per Story, written by its own operation, `points.note`:

```ts
  group
    .command('note <key>')
    .description('Show or set the note that explains a Story estimate')
    .option('--text <md>', 'the note')
    .option('--text-file <path>', 'read the note from a file, or - for stdin')
    .option('--edit', 'edit the note in $EDITOR')
    .action((key: string, opts: { text?: string; textFile?: string; edit?: boolean }, cmd) =>
      cli.run(cmd, async ({ plugin, services, print, readText }) => {
        const story = await services.stories.get(key);
        const scope = { story: story.key };
        const text = await readText({ text: opts.text, file: opts.textFile, edit: opts.edit }, { name: 'text' });
        if (text === undefined) {
          const note = await plugin.files.read(scope, 'estimate.md');
          print({ key: story.key, note }, (n) => n.note ?? `Story ${n.key} has no note.`);
          return;
        }
        // One operation, `points.note`, so other Plugins can hook it.
        await plugin.operation('note', { key: story.key }, (changes) => changes.writeFile(scope, 'estimate.md', text));
        print({ key: story.key, note: text }, (n) => `Saved the note of Story ${n.key}`);
      }),
    );
};
```

- `plugin.files.read(scope, name)` and `files.list(scope)` read **stored** files; `scope` is `'dataRoot'`, `{ board }` or `{ story }`. Writes go through a Change Set: `changes.writeFile` and `deleteFile`, and `changes.readFile` reads the **pending** version.
- `plugin.operation(name, input, body)` runs one of the Plugin's own operations, `<id>.<name>`, through the whole pipeline, so other Plugins can hook it. `name` is one lower-kebab-case word.
- Deleting a Story or Board deletes its folder with every Plugin's files. Doctor's renumbering moves the whole Story folder, files included.

**Doctor.** `doctor.check` reports findings about the Plugin's own data; Rowbly prefixes each code with the Plugin's id (`ABOVE_MAX` → `POINTS_ABOVE_MAX`) and adds `details.plugin`. A finding with `fix` is repaired by `rowbly doctor --fix`, inside doctor's Change Set:

```ts
/** Finds Stories above their Board's `max`, e.g. after `max` was lowered. `--fix` lowers them to `max`. */
async function checkPoints(
  stories: readonly Story[],
  plugin: PluginReadContext<PointsSettings>,
): Promise<PluginFinding[]> {
  const findings: PluginFinding[] = [];
  for (const story of stories) {
    const points = storyPoints(plugin, story);
    const { max } = await plugin.boardSettings(story.boardId);
    if (points === undefined || points <= max) continue;
    findings.push({
      code: 'ABOVE_MAX',
      severity: 'warning',
      path: `boards/${story.boardId}/stories/${story.key}/story.json`,
      message: `Story ${story.key} has ${points} points; its Board allows at most ${max}`,
      async fix(changes) {
        await changes.updateStory(story.key, (s) => plugin.writeBag(s, { points: max }));
        return `set Story ${story.key} to ${max} points`;
      },
    });
  }
  return findings;
}
```

**Settings.** Points reads `label` and `max`. A person sets them by hand ([Settings](README.md#settings) in the plugin system page has the full rules):

```json
{
  "plugins": { "points": { "enabled": true, "label": "Estimate", "max": 8 } }
}
```

A Board can change them in its own `board.config.json` (`"plugins": { "points": { "max": 5 } }`); objects merge, lists replace. `plugin.settings` is the Data Root's value, and `plugin.boardSettings(boardId)` a Board's. Invalid settings fail the Plugin's load, and `rowbly plugins list` shows why.

## 10. Tests

Test a Plugin through the real pipeline and storage with the test harness, `src/plugin-api/testing.ts`. Import `createPluginTestHost` and `validatePluginDefinition` from it in a test file (for example `test/plugins/points.test.ts` imports `'../../src/plugin-api/testing'`). The harness is internal to this repository until Plugin packages exist; no Plugin and no production module imports it.

```ts
it('sets, keeps and clears points, and keeps zero', async () => {
  const host = await createPluginTestHost({ plugins: [points] });
  try {
    const { services } = host;
    const story = await services.stories.create('web', { name: 'Login', plugins: { points: { points: 0 } } });
    expect(story.plugins).toEqual({ points: { points: 0 } });

    // No input for the Plugin: its bag is kept.
    const renamed = await services.stories.update(story.key, { name: 'Sign in' });
    expect(renamed.plugins).toEqual({ points: { points: 0 } });

    // `null` is the explicit clear.
    const cleared = await services.stories.update(story.key, { plugins: { points: { points: null } } });
    expect(cleared.plugins).toBeUndefined();
  } finally {
    await host.dispose();
  }
});

it('rejects malformed input before anything is saved', async () => {
  const host = await createPluginTestHost({ plugins: [points] });
  try {
    const create = host.services.stories.create('web', { name: 'A', plugins: { points: { points: -1 } } });
    await expect(create).rejects.toMatchObject({ code: 'VALIDATION', details: { plugin: 'points' } });
    expect(await host.services.stories.list('web', {})).toEqual([]);
    expect(validatePluginDefinition(points)).toEqual([]);
  } finally {
    await host.dispose();
  }
});
```

- `createPluginTestHost({ plugins, settings?, boards?, assignees?, now?, newId?, me? })` makes a Data Root of its own under the system temp folder, with Board `web` (`WEB`) unless you pass `boards`, turns `plugins` on with their `settings`, and loads them as Rowbly does. The clock is fixed at `2026-01-01T00:00:00.000Z` and ids are `id000001`, `id000002`, …. Call `dispose()` when the test finishes.
- It returns `services`, every core service, **for the test only**: set up data and check results as a person would. `context(id)` is the context that the Plugin's own commands, screens and Actions get. A Plugin that fails to load is in `warnings` and `status()`.
- `validatePluginDefinition(definition)` lists the problems Rowbly would refuse the Plugin for when it loads (names, options, Action keys, replacements and hooks); empty when it is fine.
- **TUI.** Render a screen, tab or section with `ink-testing-library`, passing `host.context(id)` and a `PluginUi` whose methods record calls. Wait for what the screen shows once its data has loaded before you press keys: reads are async, and an early key may reach a screen that is still loading. The header of `src/plugin-api/testing.ts` has the recipe. Navigation between screens needs the whole TUI: `openPluginApp` in `test/plugins/tuiHelpers.tsx` renders it with your Plugins.
- **Commands.** Run the CLI in the test process with `main(['--root', host.root.path, …], [points])` from `src/main.ts`; `test/docs/tutorial.test.ts` does this for every Points command.
- Test failure paths: malformed input saves nothing, a refusal saves nothing, and invalid stored data is kept.
- `ROWBLY_DEBUG=trace` prints every Plugin callback with its stage, time and outcome to stderr (see [Tracing](api.md#tracing)).

## 11. Advanced: replacements

A **replacement** runs instead of a core operation's body. Most Plugins never need one: a transform or a guard is enough. Trash keeps a copy of each deleted Story:

```ts
import { definePlugin } from '../../plugin-api';

/** Keeps a copy of each deleted Story in its Board's `plugins/trash/` folder. */
export const trash = definePlugin({
  id: 'trash',
  name: 'Trash',
  description: 'Keeps a copy of each deleted Story',
  replaces: {
    async 'stories.remove'({ input, changes, core, plugin }) {
      const story = await plugin.services.stories.get(input.key);
      // The copy and the deletion are one Change Set: both are saved, or neither.
      await changes.writeFile({ board: story.boardId }, `${story.key}.json`, `${JSON.stringify(story, null, 2)}\n`);
      // At most once; its errors pass through with their own code. Its result is the operation's result.
      return core();
    },
  },
});
```

- The replacement works on the same Change Set as the transforms and guards that follow it. The order is unchanged: replacement → transforms → guards → save → reactions.
- `core()` runs the core body against that Change Set, **at most once**: a second call fails the operation. Its errors pass through with their own code.
- Not calling `core()` is allowed. The replacement's result is the operation's result, so it must be the shape the operation returns.
- Only one Plugin may replace an operation, and only core operations can be replaced.

## 12. Checklist for a Built-in Plugin

- [ ] A folder `src/plugins/<id>/` with an `index.ts` that exports `definePlugin({ id, name, description, … })`; `id` is the folder name.
- [ ] An entry in `builtInPlugins` in `src/plugins/index.ts`, where its position is its run order.
- [ ] A glossary, `src/plugins/<id>/CONTEXT.md`, with the Plugin's terms and at least one `_Avoid_` line, linked from [`docs/agents/CONTEXT-MAP.md`](../agents/CONTEXT-MAP.md) with its relationship to core. `test/e2e/language.test.ts` reads it and checks the Plugin's messages and help pages against its `_Avoid_` words.
- [ ] Imports only from `../../plugin-api`, `../../plugin-api/tui` (TUI part only) and its own files (`test/architecture.test.ts`).
- [ ] The TUI part is loaded lazily: `tui: () => import('./tui').then((m) => m.tui)`.
- [ ] Every data change it offers works in both the CLI and the TUI; Actions only open or show something.
- [ ] Tests under `test/plugins/`, including failure paths.
- [ ] Turned on in a Data Root with `rowbly plugins enable <id>`; `rowbly init` turns no Plugins on.
- [ ] Its section in [`built-in.md`](built-in.md), its row in the [context map](../agents/CONTEXT-MAP.md), and its operations in [Operations](../architecture/operations.md).
