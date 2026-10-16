// Compile fixtures for the author API (WP04B). `pnpm typecheck` checks this file: each
// `@ts-expect-error` must meet an error, so a contract that loosens fails the build. The functions
// are never called. A consumer imports only `src/plugin-api` (DX-33).
import { describe, expect, it } from 'vitest';
import {
  type Command,
  definePlugin,
  type Label,
  type PluginAction,
  type PluginCommands,
  type PluginFieldKind,
  type PluginFinding,
  type PluginFormField,
  type PluginFormValue,
  type PluginOption,
  type PluginOptionValues,
  type PluginStatus,
  parseRepeatable,
  parseTaskId,
  z,
} from '../../src/plugin-api';
import type { FieldKind, FormField, FormValue } from '../../src/tui/components';

const Input = z.object({ epic: z.string().nullable() });

function inputsAreTyped() {
  definePlugin({
    id: 'typed',
    name: 'Typed',
    description: '',
    settings: z.object({ marker: z.string() }),
    inputs: { 'stories.update': Input },
    storyFilterSchema: z.number(),
    hooks: {
      'stories.update': {
        transform({ pluginInput, plugin }) {
          // Parsed input, no cast: `{ epic: string | null } | undefined`.
          const epic: string | null | undefined = pluginInput?.epic;
          const marker: string = plugin.settings.marker;
          return void [epic, marker];
        },
        guard({ pluginInput }) {
          // @ts-expect-error the input's type comes from the schema
          pluginInput?.missing;
        },
      },
      'stories.create': {
        // Without a schema the input is `unknown`, the honest fallback.
        transform({ pluginInput }) {
          // @ts-expect-error unknown input must be narrowed first
          pluginInput.epic;
        },
      },
    },
    options: {
      'stories edit': {
        options: [{ flags: '--epic <id>', description: '' }],
        // @ts-expect-error a converter must return the schema's input type
        input: ({ epic }) => ({ epic }),
      },
      'stories list': {
        options: [{ flags: '--points <n>', description: '' }],
        filter: ({ points }) => (typeof points === 'string' ? Number(points) : undefined),
      },
    },
    filterStories: (_story, filter) => filter > 0,
  });
}

function filtersAreNotInput() {
  definePlugin({
    id: 'f',
    name: 'F',
    description: '',
    options: {
      // @ts-expect-error `stories list` takes criteria: `filter`, not `input` (DX-12)
      'stories list': { options: [], input: () => true },
      // @ts-expect-error commands that run an operation take `input`, not `filter`
      'stories create': { options: [], filter: () => true },
    },
  });
}

function rawOptionValuesAreTyped(values: PluginOptionValues) {
  const value = values.addSpec;
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return parseRepeatable(value);
  // @ts-expect-error the remaining values are boolean or undefined
  return value.length;
}

function actionsNarrowTheirFocus() {
  const actions: PluginAction[] = [
    { key: 'S', label: 'Story', target: 'story', run: ({ focus }) => void focus.story.key },
    { key: 'T', label: 'Task', target: 'task', run: ({ focus }) => void [focus.task.id, focus.story.key] },
    { key: 'B', label: 'Board', target: 'board', run: ({ focus }) => void focus.board.id },
    // @ts-expect-error a Story Action is not promised a Task
    { key: 'X', label: 'Wrong', target: 'story', run: ({ focus }) => void focus.task.id },
    { key: 'N', label: 'None', target: 'none', run: ({ focus }) => void focus.story?.key },
  ];
  return actions;
}

function formTypesAreShared(field: PluginFormField, value: PluginFormValue, kind: PluginFieldKind) {
  // The TUI's form types are the Plugin API's, so neither can drift (CQ-18).
  const asForm: FormField = field;
  const asValue: FormValue = value;
  const asKind: FieldKind = kind;
  const back: PluginFieldKind = asKind;
  return [asForm, asValue, back];
}

/** A consumer annotates its commands, options, labels, statuses and findings from the Plugin API only. */
const commands: PluginCommands = (group: Command, cli) => {
  group.command('list').action((_opts: unknown, cmd: Command) => cli.run(cmd, async () => {}));
};
const option: PluginOption = { flags: '--tag <label>', description: 'a Label', repeatable: true };
const label: Label = 'backend';
const statusLine = (status: PluginStatus) => `${status.id}: ${status.loaded ? 'on' : 'off'}`;
const finding: PluginFinding = { code: 'X', severity: 'info', path: 'rowbly.config.json', message: 'x' };

describe('author API types', () => {
  it('compiles the fixtures (checked by `pnpm typecheck`)', () => {
    const fixtures = [
      inputsAreTyped,
      filtersAreNotInput,
      rawOptionValuesAreTyped,
      actionsNarrowTheirFocus,
      formTypesAreShared,
      commands,
      statusLine,
    ];
    expect(fixtures.every((f) => typeof f === 'function')).toBe(true);
    expect([option.flags, label, finding.code]).toEqual(['--tag <label>', 'backend', 'X']);
    expect(parseTaskId('web-1.2').storyKey).toBe('WEB-1');
    expect(parseRepeatable(['a,b', ' c', 'a'])).toEqual(['a', 'b', 'c']);
  });
});
