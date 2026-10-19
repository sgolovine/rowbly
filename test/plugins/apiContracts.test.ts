// The run-time half of the Plugin API safety contracts (WP04A): capabilities, bags, results and the
// operation result passed to pre-save hooks. The compile-time half is in apiTypes.test.ts.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DataIntegrityError, PluginError } from '../../src/core';
import { createProgram, reservedNames } from '../../src/main';
import { type Bagged, definePlugin, type PluginCommandEnv, type Story, z } from '../../src/plugin-api';
import { epics } from '../../src/plugins/epics';
import { createEpic } from '../../src/plugins/epics/service';
import { specs } from '../../src/plugins/specs';
import { loadPlugins } from '../../src/services';
import { FIXED_NOW, makeStory, runCli } from '../helpers';
import { notes } from './fixtures';
import { pluginRoot, readJsonFile, storyFile, withPlugins } from './helpers';

const Bag = z.object({ n: z.number() });

/** A Plugin that only records what reactions receive. */
function probe() {
  const results: Record<string, unknown> = {};
  const record = {
    react({ name, result }: { name: string; result: unknown }) {
      results[name] = result;
    },
  };
  const plugin = definePlugin({
    id: 'probe',
    name: 'Probe',
    description: '',
    hooks: {
      'fields.update': record,
      'boards.remove': record,
      'context.clearUse': record,
      'context.use': record,
      'plugins.enable': record,
      'plugins.disable': record,
    },
  });
  return { plugin, results };
}

describe('operation results (ARCH-14)', () => {
  it('reactions receive the public result of each operation; service callers are unchanged', async () => {
    const t = await pluginRoot({ probe: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', customFields: { size: 'huge' } });
    const { plugin, results } = probe();
    const { services, ctx, warnings } = await withPlugins(t, [plugin, notes]);

    await services.fields.add({ level: 'global' }, { key: 'size', name: 'Size', type: 'select', options: ['huge'] });
    const fields = await services.fields.update({ level: 'global' }, 'size', { options: ['small'] });
    expect(fields).toEqual([{ key: 'size', name: 'Size', type: 'select', options: ['small'], required: false }]);
    expect(results['fields.update']).toEqual(fields);
    expect(warnings).toContain('stripped 1 value of "size" that no longer fit the Custom Field');

    expect(await services.context.use('web')).toEqual({ version: 1, board: 'web' });
    expect(results['context.use']).toEqual({ version: 1, board: 'web' });
    await services.context.clearUse();
    expect('context.clearUse' in results).toBe(true);
    expect(results['context.clearUse']).toBeUndefined();
    expect(ctx.local).toEqual({ version: 1 });

    await services.context.use('web');
    await services.boards.remove('web', { force: true });
    expect('boards.remove' in results).toBe(true);
    expect(results['boards.remove']).toBeUndefined();
    expect(ctx.local).toEqual({ version: 1 });

    expect(await services.plugins.disable('notes')).toEqual({ id: 'notes', enabled: false });
    expect(results['plugins.disable']).toEqual({ id: 'notes', enabled: false });
    expect(await services.plugins.enable('notes')).toEqual({ id: 'notes', enabled: true });
    expect(results['plugins.enable']).toEqual({ id: 'notes', enabled: true });
  });
});

/** Puts a decoy Story into the Change Set before core creates the real one, and returns the real one. */
const decoy = definePlugin({
  id: 'decoy',
  name: 'Decoy',
  description: '',
  replaces: {
    'stories.create': async ({ changes, core }) => {
      const story: Story = {
        version: 1,
        key: 'WEB-50',
        boardId: 'web',
        name: 'Decoy',
        description: '',
        stage: 'backlog',
        rank: 'a0',
        priority: null,
        labels: [],
        dueDate: null,
        customFields: {},
        createdBy: null,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      };
      await changes.putStory(story);
      return core();
    },
  },
});

describe('pre-save hooks see the operation result (ARCH-03)', () => {
  it('Epic, Specs and Notes input apply to the Story the replacement returns, not the first one created', async () => {
    const t = await pluginRoot({ decoy: true, epics: true, specs: true, notes: true });
    await mkdir(join(t.path, 'boards/web/plugins/specs'), { recursive: true });
    await writeFile(join(t.path, 'boards/web/plugins/specs/login.md'), '# Login\n');
    const { services } = await withPlugins(t, [decoy, epics, specs, notes]);
    await createEpic(services.plugins.context('epics'), { id: 'auth', name: 'Auth' });

    const story = await services.stories.create('web', {
      name: 'Real',
      plugins: { epics: { epic: 'auth' }, specs: { specs: ['login'] }, notes: { note: 'hi' } },
    });
    expect(story.key).toBe('WEB-1');
    expect(story.plugins).toEqual({ epics: { epic: 'auth' }, specs: { specs: ['login'] }, notes: { note: 'hi' } });
    expect((await readJsonFile(t, storyFile('WEB-1'))).plugins).toEqual(story.plugins);
    expect(await readJsonFile(t, storyFile('WEB-50'))).not.toHaveProperty('plugins');
  });

  it('transforms and guards receive the body result; replacements have none', async () => {
    const t = await pluginRoot({ seer: true });
    const seen: Record<string, unknown> = {};
    const seer = definePlugin({
      id: 'seer',
      name: 'Seer',
      description: '',
      hooks: {
        'stories.create': {
          transform({ result }) {
            seen.transform = result.key;
          },
          guard({ result }) {
            seen.guard = result.key;
          },
        },
      },
    });
    const { services } = await withPlugins(t, [seer]);
    await services.stories.create('web', { name: 'A' });
    expect(seen).toEqual({ transform: 'WEB-1', guard: 'WEB-1' });
  });
});

describe('capabilities (ARCH-05, ARCH-11, SEC-03)', () => {
  it('a Plugin context has PluginServices only, built at run time; core keeps full Services', async () => {
    const t = await pluginRoot({ notes: true });
    const { services } = await withPlugins(t, [notes]);
    const plugin = services.plugins.context('notes');
    const reachable = plugin.services as unknown as Record<string, unknown>;
    expect(reachable.plugins).toBeUndefined();
    expect(reachable.setup).toBeUndefined();
    expect(Object.keys(plugin.services.doctor)).toEqual(['check']);
    expect(Object.keys(plugin.services).sort()).toEqual(
      ['boards', 'config', 'context', 'doctor', 'fields', 'stages', 'stories'].sort(),
    );
    expect('editText' in plugin).toBe(false);
    expect(typeof services.plugins.context).toBe('function');
    expect(typeof services.setup.init).toBe('function');
    expect(typeof services.doctor.fix).toBe('function');
  });

  it('hook contexts have read services only and neither operation nor editText', async () => {
    const t = await pluginRoot({ peek: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const contexts: Record<string, unknown>[] = [];
    const peek = definePlugin({
      id: 'peek',
      name: 'Peek',
      description: '',
      hooks: { 'stories.update': { transform: ({ plugin }) => void contexts.push(plugin as never) } },
      doctor: {
        check({ plugin }) {
          contexts.push(plugin as never);
          return [];
        },
      },
    });
    const { services } = await withPlugins(t, [peek]);
    await services.stories.update('WEB-1', { name: 'B' });
    await services.doctor.check();
    expect(contexts).toHaveLength(2);
    for (const context of contexts) {
      expect('operation' in context).toBe(false);
      expect('editText' in context).toBe(false);
      const read = context.services as Record<string, Record<string, unknown>>;
      expect(read.plugins).toBeUndefined();
      expect(read.setup).toBeUndefined();
      expect(read.doctor).toBeUndefined();
      expect(Object.keys(read.stories ?? {}).sort()).toEqual(['get', 'labelsInUse', 'list']);
      expect(read.tasks).toBeUndefined();
      expect(Object.keys(read.boards ?? {}).sort()).toEqual(['get', 'list']);
      expect(Object.keys(read.context ?? {})).toEqual(['resolveBoard']);
    }
  });

  it('a command env has PluginServices and the only editor', async () => {
    const t = await pluginRoot({ cmd: true });
    let env: PluginCommandEnv<unknown> | undefined;
    const cmd = definePlugin({
      id: 'cmd',
      name: 'Cmd',
      description: '',
      commands(group, cli) {
        group.command('peek').action((_opts: unknown, command) =>
          cli.run(command, async (given) => {
            env = given;
          }),
        );
      },
    });
    const host = await loadPlugins({ root: t.root, registry: [cmd], reserved: reservedNames() });
    await createProgram(host).parseAsync(['cmd', 'peek', '--root', t.path], { from: 'user' });
    if (!env) throw new Error('the command did not run');
    const reachable = env.services as unknown as Record<string, unknown>;
    expect(reachable.plugins).toBeUndefined();
    expect(reachable.setup).toBeUndefined();
    expect(Object.keys(env.services.doctor)).toEqual(['check']);
    expect(typeof env.editText).toBe('function');
    expect('editText' in env.plugin).toBe(false);
    expect((env.plugin.services as unknown as Record<string, unknown>).plugins).toBeUndefined();
  });
});

describe('bags (ARCH-36, ARCH-08, CQ-165)', () => {
  async function context() {
    const t = await pluginRoot({ notes: true });
    const { services } = await withPlugins(t, [notes]);
    return { t, services, plugin: services.plugins.context('notes') };
  }

  it('inspectBag tells absent, valid and invalid apart; readBag stays tolerant', async () => {
    const { plugin } = await context();
    expect(plugin.inspectBag({}, Bag)).toEqual({ kind: 'absent' });
    expect(plugin.inspectBag({ plugins: { notes: { n: 1 } } }, Bag)).toEqual({ kind: 'valid', value: { n: 1 } });
    const invalid = plugin.inspectBag({ plugins: { notes: { n: 'x' } } }, Bag);
    expect(invalid).toMatchObject({ kind: 'invalid', raw: { n: 'x' } });
    expect(invalid.kind === 'invalid' && invalid.issues[0]?.path).toEqual(['n']);
    expect(plugin.readBag({ plugins: { notes: { n: 'x' } } }, Bag)).toBeUndefined();
    expect(plugin.readBag({}, Bag)).toBeUndefined();
  });

  it('requireBag returns undefined only when absent and throws DATA_INTEGRITY for an invalid bag', async () => {
    const { plugin } = await context();
    expect(plugin.requireBag({}, Bag)).toBeUndefined();
    expect(plugin.requireBag({ plugins: { notes: { n: 2 } } }, Bag)).toEqual({ n: 2 });
    const story = { key: 'WEB-1', boardId: 'web', plugins: { notes: { n: 'x' } } };
    let err: unknown;
    try {
      plugin.requireBag(story, Bag);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DataIntegrityError);
    expect(err).toMatchObject({
      code: 'DATA_INTEGRITY',
      exitCode: 6,
      message: 'Plugin "notes" data on Story WEB-1 is not valid',
      hint: 'run `rowbly doctor`; fix or reset the value before changing it',
      details: { plugin: 'notes', path: 'plugins.notes', record: 'Story WEB-1' },
    });
    expect((err as DataIntegrityError).details.issues).toEqual([expect.objectContaining({ path: ['n'] })]);
  });

  it('writeBag sets or clears only its own bag and drops an empty plugins', async () => {
    const { plugin } = await context();
    const story = { key: 'WEB-1', boardId: 'web', plugins: { notes: { n: 1 }, other: { x: true } } };
    expect(plugin.writeBag(story, { n: 2 })).toEqual({ ...story, plugins: { notes: { n: 2 }, other: { x: true } } });
    expect(plugin.writeBag(story, undefined)).toEqual({ ...story, plugins: { other: { x: true } } });
    expect(plugin.writeBag({ key: 'WEB-1', plugins: { notes: { n: 1 } } }, undefined)).toEqual({ key: 'WEB-1' });
    const assignee: Bagged & { handle: string; name: string } = { handle: 'alice', name: 'A' };
    expect(plugin.writeBag(assignee, { n: 1 })).toMatchObject({ plugins: { notes: { n: 1 } } });
    const local: Bagged & { version: number; board: string } = { version: 1, board: 'web' };
    expect(plugin.writeBag(local, { n: 1 })).toEqual({
      version: 1,
      board: 'web',
      plugins: { notes: { n: 1 } },
    });
  });

  it('writeBag on the root config fails before the save; an explicit merge keeps enabled and other entries', async () => {
    const t = await pluginRoot({}, { plugins: { notes: { enabled: true }, gone: { enabled: false, keep: 1 } } });
    const plugin = (await withPlugins(t, [notes])).services.plugins.context('notes');
    const before = await readJsonFile(t, 'rowbly.config.json');
    const err = await plugin
      .operation('settings', {}, (changes) =>
        changes.updateRootConfig((config) => plugin.writeBag(config, { marker: 'x' }) as typeof config),
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PluginError);
    expect(err).toMatchObject({
      message: 'Plugin "notes" cannot use writeBag on rowbly.config.json',
      details: { plugin: 'notes' },
    });
    expect(await readJsonFile(t, 'rowbly.config.json')).toEqual(before);

    await plugin.operation('settings', {}, (changes) =>
      changes.updateRootConfig((config) => ({
        ...config,
        plugins: { ...config.plugins, notes: { marker: 'x', enabled: config.plugins?.notes?.enabled } },
      })),
    );
    expect((await readJsonFile(t, 'rowbly.config.json')).plugins).toEqual({
      notes: { marker: 'x', enabled: true },
      gone: { enabled: false, keep: 1 },
    });
  });
});

describe('the CLI editor (ARCH-11, SEC-03)', () => {
  it('Specs seeds $VISUAL with the title once and does not apply it again to the saved text', async () => {
    const t = await pluginRoot({ specs: true });
    const cli = (args: string[], env: NodeJS.ProcessEnv = {}) => runCli(args, { root: t.path, env });
    expect((await cli(['specs', 'create', 'auth', '--title', 'Auth', '--text', 'Body'])).exitCode).toBe(0);
    const seen = join(t.dir, 'seen.md');
    const editor = join(t.dir, 'editor.sh');
    await writeFile(editor, `#!/bin/sh\ncp "$1" "${seen}"\nprintf "# Mine\\n\\nNew body\\n" > "$1"\n`, { mode: 0o755 });

    const edited = await cli(['specs', 'edit', 'auth', '--title', 'Seeded', '--edit'], {
      VISUAL: editor,
      EDITOR: 'false',
    });
    expect(edited.exitCode).toBe(0);
    expect(await readFile(seen, 'utf8')).toBe('# Seeded\n\nBody');
    expect((await cli(['specs', 'show', 'auth'])).stdout).toContain('# Mine\n\nNew body');
  });
});
