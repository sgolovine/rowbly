// Compile fixtures for the Plugin API contracts (WP04A). `pnpm typecheck` checks this file: each
// `@ts-expect-error` must meet an error, so a contract that loosens fails the build. The functions
// are never called.
import { describe, expect, it } from 'vitest';
import {
  type Bagged,
  CORE_OPERATION_NAMES,
  type CoreOperationName,
  type CustomFieldDef,
  definePlugin,
  type PluginCommandEnv,
  type PluginContext,
  type PluginHookContext,
  type Story,
  z,
} from '../../src/plugin-api';
import type { OperationRunner } from '../../src/services/plugins/runtime';

declare const story: Story;

function guardsCannotWrite() {
  definePlugin({
    id: 'g',
    name: 'G',
    description: '',
    hooks: {
      'stories.update': {
        async guard({ changes }) {
          // @ts-expect-error a guard's view has no writers
          await changes.putStory(story);
          // @ts-expect-error a guard's view has no writers
          await changes.writeFile('dataRoot', 'a.txt', 'a');
          for (const change of changes.changes) {
            // @ts-expect-error snapshots are deeply readonly
            change.after = null;
          }
          await changes.readFile('dataRoot', 'a.txt');
        },
        async transform({ changes, result }) {
          await changes.updateStory(result.key, (s) => s);
          // @ts-expect-error the result is deeply readonly
          result.labels.push('x');
        },
      },
    },
  });
}

function hookContextsHaveNoOperationOrEditor(plugin: PluginHookContext, context: PluginContext) {
  // @ts-expect-error hooks change data through their Change Set
  plugin.operation('x', {}, async () => undefined);
  // @ts-expect-error the editor is only on PluginCommandEnv
  plugin.editText('');
  // @ts-expect-error hooks get read services only
  plugin.services.stories.update('WEB-1', {});
  // @ts-expect-error no other Plugin's context
  context.services.plugins.context('other');
  // @ts-expect-error no setup
  context.services.setup.init;
  // @ts-expect-error doctor checks only
  context.services.doctor.fix();
  // @ts-expect-error the editor is only on PluginCommandEnv
  context.editText('');
  context.services.stories.update('WEB-1', {});
}

function commandEnvHasTheEditor(env: PluginCommandEnv<unknown>): Promise<string> {
  return env.editText('# Title');
}

function coreBodyResultsAreChecked(ops: OperationRunner) {
  const input = { target: { level: 'global' as const }, key: 'size' };
  // @ts-expect-error fields.update returns the fields, not service bookkeeping
  ops.run('fields.update', input, async () => ({ next: [], stripped: 0 }));
  // @ts-expect-error boards.remove returns nothing
  ops.run('boards.remove', { id: 'web', force: true }, async () => ({ version: 1 as const }));
  ops.run('fields.update', input, async () => [] as CustomFieldDef[]);
  ops.run('boards.remove', { id: 'web', force: true }, async () => {});
  ops.run('notes.add', { name: 'a' }, async () => 42);
}

interface Linked extends Bagged {
  plugins: { epics: { epic: string } };
}

function clearedBagsCannotBeDereferenced(plugin: PluginHookContext, linked: Linked) {
  const cleared = plugin.writeBag(linked, undefined);
  // @ts-expect-error a cleared or replaced bag is only `Bagged`
  cleared.plugins.epics.epic;
  // @ts-expect-error a bag is a record, not an array
  plugin.writeBag(story, [1]);
  // @ts-expect-error a bag is a record, not a Date
  plugin.writeBag(story, new Date());
  const kept: Story = plugin.writeBag(story, { epic: 'auth' });
  return kept;
}

function settingsAndResultsAreInferred() {
  definePlugin({
    id: 's',
    name: 'S',
    description: '',
    settings: z.object({ marker: z.string() }),
    hooks: {
      'stories.create': {
        guard() {},
        transform({ plugin }) {
          const marker: string = plugin.settings.marker;
          // @ts-expect-error settings are typed
          plugin.settings.missing;
          return void marker;
        },
      },
      'fields.update': { react: ({ result }) => void result.map((field) => field.key) },
      'plugins.enable': { react: ({ result }) => void (result.id + String(result.enabled)) },
      'boards.remove': {
        async guard({ input }) {
          return input.force ? undefined : { reject: 'no', canForce: true };
        },
      },
    },
  });
}

describe('Plugin API types', () => {
  it('compiles the fixtures (checked by `pnpm typecheck`)', () => {
    const fixtures = [
      guardsCannotWrite,
      hookContextsHaveNoOperationOrEditor,
      commandEnvHasTheEditor,
      coreBodyResultsAreChecked,
      clearedBagsCannotBeDereferenced,
      settingsAndResultsAreInferred,
    ];
    expect(fixtures.every((f) => typeof f === 'function')).toBe(true);
  });

  it('lists every core operation name once', () => {
    const names: readonly CoreOperationName[] = CORE_OPERATION_NAMES;
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('stories.create');
  });
});
