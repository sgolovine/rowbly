// The Plugin test harness as an author uses it (DX-15, TEST-01): this file imports only the Plugin
// API, its test harness and Vitest, like a Plugin's own tests would. A check at the end keeps it so.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { definePlugin, z } from '../../src/plugin-api';
import {
  createPluginTestHost,
  type PluginTestHost,
  TEST_NOW,
  validatePluginDefinition,
} from '../../src/plugin-api/testing';

const FlagBag = z.object({ flag: z.string().min(1) });

/** A sample Plugin: a Story flag set and cleared through its input, and a guard on Story names. */
const flags = definePlugin({
  id: 'flags',
  name: 'Flags',
  description: 'A flag on a Story',
  settings: z.object({ refuse: z.string().default('Refused') }),
  bags: { story: FlagBag },
  inputs: { 'stories.update': z.object({ flag: z.string().nullable() }) },
  hooks: {
    'stories.update': {
      async transform({ changes, input, pluginInput, plugin }) {
        if (pluginInput === undefined) return;
        const flag = pluginInput.flag;
        await changes.updateStory(input.key, (story) => plugin.writeBag(story, flag === null ? undefined : { flag }));
      },
      guard({ input, plugin }) {
        if (input.name === plugin.settings.refuse) return { reject: `Flags refuses "${input.name}"` };
        return undefined;
      },
    },
  },
});

/** Records the order Plugins run in, in its own bag. */
const tracer = (id: string) =>
  definePlugin({
    id,
    name: id,
    description: `Tracer ${id}`,
    hooks: {
      'stories.create': {
        async transform({ changes, result, plugin }) {
          await changes.updateStory(result.key, (story) => {
            const order = (story.plugins?.trace?.order as string[] | undefined) ?? [];
            return plugin.writeBag({ ...story, plugins: { ...story.plugins, trace: { order: [...order, id] } } }, {});
          });
        },
      },
    },
  });

const hosts: PluginTestHost[] = [];
async function host(...args: Parameters<typeof createPluginTestHost>) {
  const created = await createPluginTestHost(...args);
  hosts.push(created);
  return created;
}
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((h) => h.dispose()));
});

describe('createPluginTestHost', () => {
  it('sets and clears a Story bag through the real pipeline and storage', async () => {
    const { services, context } = await host({ plugins: [flags] });
    const story = await services.stories.create('web', { name: 'Login' });
    expect(story).toMatchObject({ key: 'WEB-1', createdAt: TEST_NOW });

    await services.stories.update('WEB-1', { plugins: { flags: { flag: 'urgent' } } });
    const stored = await services.stories.get('WEB-1');
    expect(context('flags').readBag(stored, FlagBag)).toEqual({ flag: 'urgent' });

    await services.stories.update('WEB-1', { plugins: { flags: { flag: null } } });
    expect((await services.stories.get('WEB-1')).plugins?.flags).toBeUndefined();
  });

  it('a rejecting guard saves nothing', async () => {
    const { services } = await host({ plugins: [flags], settings: { flags: { refuse: 'Nope' } } });
    await services.stories.create('web', { name: 'Login' });
    await expect(
      services.stories.update('WEB-1', { name: 'Nope', plugins: { flags: { flag: 'x' } } }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { plugin: 'flags', stage: 'guard' } });
    const stored = await services.stories.get('WEB-1');
    expect(stored.name).toBe('Login');
    expect(stored.plugins?.flags).toBeUndefined();
  });

  it('gives two hosts independent Data Roots, status and contexts', async () => {
    const a = await host({ plugins: [flags] });
    const b = await host({ plugins: [tracer('first')], boards: [{ id: 'api', name: 'API', keyPrefix: 'API' }] });
    expect(a.root.path).not.toBe(b.root.path);
    expect(a.status().map((s) => [s.id, s.loaded])).toEqual([['flags', true]]);
    expect(b.status().map((s) => [s.id, s.loaded])).toEqual([['first', true]]);
    expect(() => a.context('first')).toThrow();
    expect(a.context('flags').settings).toEqual({ refuse: 'Refused' });

    await a.services.stories.create('web', { name: 'In a' });
    expect((await a.services.stories.list(null, {})).map((s) => s.key)).toEqual(['WEB-1']);
    expect(await b.services.stories.list(null, {})).toEqual([]);
    expect((await b.services.boards.list()).map((board) => board.id)).toEqual(['api']);
  });

  it('uses the clock, ids and Me it is given', async () => {
    let tick = 0;
    const { services } = await host({
      plugins: [],
      now: () => new Date(Date.UTC(2030, 0, 1, 0, 0, tick++)),
      assignees: [{ handle: 'alice', name: 'Alice' }],
      me: 'alice',
    });
    const story = await services.stories.create('web', { name: 'Mine', assignees: ['me'] });
    expect(story.assignees).toEqual(['alice']);
    expect(story.createdAt.startsWith('2030-01-01T00:00:')).toBe(true);
  });

  it('runs several Plugins in the order given', async () => {
    const { services } = await host({ plugins: [tracer('first'), tracer('second'), tracer('third')] });
    const story = await services.stories.create('web', { name: 'Ordered' });
    expect(story.plugins?.trace).toEqual({ order: ['first', 'second', 'third'] });
  });

  it('reports a Plugin that fails to load and runs without it', async () => {
    const broken = definePlugin({
      id: 'broken',
      name: 'Broken',
      description: 'Fails to start',
      start() {
        throw new Error('no start');
      },
    });
    const { status, warnings } = await host({ plugins: [broken, flags] });
    expect(status().map((s) => [s.id, s.loaded])).toEqual([
      ['broken', false],
      ['flags', true],
    ]);
    expect(warnings).toEqual([expect.stringContaining('Plugin "broken" failed to load')]);
  });

  it('removes its Data Root on dispose', async () => {
    const created = await createPluginTestHost({ plugins: [flags] });
    await created.services.stories.create('web', { name: 'Gone soon' });
    await created.dispose();
    await expect(readFile(`${created.root.path}/rowbly.config.json`, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('validatePluginDefinition', () => {
  it('finds the names a Plugin would be rejected for, without loading it', () => {
    expect(validatePluginDefinition(flags)).toEqual([]);
    const clash = definePlugin({
      id: 'stories',
      name: 'Clash',
      description: 'Takes a core name',
      options: {
        'stories create': { options: [{ flags: '--name <text>', description: 'clash' }], input: () => undefined },
      },
    });
    expect(validatePluginDefinition(clash).map((d) => d.path)).toEqual([
      'id',
      expect.stringContaining('stories create'),
    ]);
  });
});

it('this file imports only the Plugin API, its test harness and Vitest (DX-15)', async () => {
  const source = await readFile(fileURLToPath(import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^import [^;]*? from '([^']+)';$/gm)].map((m) => m[1]);
  // `node:` built-ins only read this file and the removed Data Root above.
  expect(imports.filter((spec) => !spec?.startsWith('node:'))).toEqual([
    'vitest',
    '../../src/plugin-api',
    '../../src/plugin-api/testing',
  ]);
});
