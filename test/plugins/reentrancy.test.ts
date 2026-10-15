// RES-05, ARCH-06, DX-17: a hook cannot start another operation (ADR-0020 §1, D4).
import { describe, expect, it } from 'vitest';
import { NotFoundError, PluginError } from '../../src/core';
import { definePlugin } from '../../src/plugin-api';
import type { Services } from '../../src/services';
import { makeStory } from '../helpers';
import { notes } from './fixtures';
import { pluginRoot, readJsonFile, storyFile, withPlugins } from './helpers';

/** A promise and its resolver, to order concurrent work without sleeping. */
function barrier<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Holds the services the test builds, so a hook can use them as a captured command context would. */
function captured() {
  const box: { services?: Services } = {};
  return {
    box,
    get services(): Services {
      if (!box.services) throw new Error('services not set');
      return box.services;
    },
  };
}

describe('nested operations from hooks (RES-05, ARCH-06)', () => {
  it('a transform that calls a core mutation saves nothing and fails with an attributed error', async () => {
    const cap = captured();
    const nested = definePlugin({
      id: 'nested',
      name: 'Nested',
      description: '',
      hooks: {
        'stories.update': {
          async transform({ input }) {
            if (input.description === 'from-hook') return;
            await cap.services.stories.update(input.key, { description: 'from-hook' });
          },
        },
      },
    });
    const t = await pluginRoot({ nested: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [nested]);
    cap.box.services = services;

    const err = await services.stories.update('WEB-1', { name: 'Renamed by caller' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PluginError);
    expect(err).toMatchObject({
      code: 'INTERNAL',
      message: expect.stringContaining(
        'Plugin "nested" tried to start stories.update during the transform of stories.update',
      ),
      details: { plugin: 'nested', operation: 'stories.update', stage: 'transform', nested: 'stories.update' },
      hint: 'change data through the Change Set your transform receives, not through services or operations',
    });
    const disk = await readJsonFile(t, storyFile('WEB-1'));
    expect(disk).toMatchObject({ name: 'Story WEB-1', description: '' });
  });

  it('a transform that runs plugin.operation through a captured context saves nothing', async () => {
    const cap = captured();
    const sneaky = definePlugin({
      id: 'sneaky',
      name: 'Sneaky',
      description: '',
      hooks: {
        'stories.update': {
          async transform() {
            await cap.services.plugins.context('sneaky').operation('touch', {}, async (changes) => {
              await changes.writeFile('dataRoot', 'touched.txt', 'yes');
            });
          },
        },
      },
    });
    const t = await pluginRoot({ sneaky: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [sneaky]);
    cap.box.services = services;

    const err = await services.stories.update('WEB-1', { name: 'X' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PluginError);
    expect((err as PluginError).message).toContain('tried to start sneaky.touch during the transform');
    expect(await services.plugins.context('sneaky').files.read('dataRoot', 'touched.txt')).toBeNull();
    expect((await readJsonFile(t, storyFile('WEB-1'))).name).toBe('Story WEB-1');
  });

  it('a recursive hook stops at the first nested call', async () => {
    const cap = captured();
    let depth = 0;
    const loop = definePlugin({
      id: 'loop',
      name: 'Loop',
      description: '',
      hooks: {
        'boards.update': {
          async transform({ input }) {
            depth++;
            if (depth > 50) throw new Error(`gave up at depth ${depth}`);
            await cap.services.boards.update(input.id, { description: `d${depth}` });
          },
        },
      },
    });
    const t = await pluginRoot({ loop: true });
    const { services } = await withPlugins(t, [loop]);
    cap.box.services = services;

    await expect(services.boards.update('web', { name: 'X' })).rejects.toBeInstanceOf(PluginError);
    expect(depth).toBe(1);
    expect((await services.boards.get('web')).name).toBe('Website');
  });

  it.each(['guard', 'react'] as const)('a %s cannot start a core mutation', async (hook) => {
    const cap = captured();
    const seen: unknown[] = [];
    const run = async () => {
      try {
        await cap.services.stories.update('WEB-2', { name: 'From hook' });
      } catch (err) {
        seen.push(err);
      }
    };
    const plugin = definePlugin({
      id: 'hooker',
      name: 'Hooker',
      description: '',
      hooks: { 'stories.update': hook === 'guard' ? { guard: run } : { react: run } },
    });
    const t = await pluginRoot({ hooker: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-2' });
    const { services } = await withPlugins(t, [plugin]);
    cap.box.services = services;

    await services.stories.update('WEB-1', { name: 'Outer' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(PluginError);
    expect((seen[0] as PluginError).details).toMatchObject({
      plugin: 'hooker',
      stage: hook === 'guard' ? 'guard' : 'reaction',
      nested: 'stories.update',
    });
    expect((await readJsonFile(t, storyFile('WEB-2'))).name).toBe('Story WEB-2');
    expect((await readJsonFile(t, storyFile('WEB-1'))).name).toBe('Outer');
  });

  it('a detached continuation of a reaction is still rejected after the reaction ended', async () => {
    const cap = captured();
    const done = barrier<unknown>();
    const late = definePlugin({
      id: 'late',
      name: 'Late',
      description: '',
      hooks: {
        'stories.update': {
          react() {
            setTimeout(() => {
              cap.services.stories.update('WEB-1', { name: 'Late' }).then(done.resolve, done.resolve);
            }, 0);
          },
        },
      },
    });
    const t = await pluginRoot({ late: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [late]);
    cap.box.services = services;

    await services.stories.update('WEB-1', { name: 'Outer' });
    const err = await done.promise;
    expect(err).toBeInstanceOf(PluginError);
    expect((await readJsonFile(t, storyFile('WEB-1'))).name).toBe('Outer');
  });

  it('a plugin operation body cannot start another operation', async () => {
    const t = await pluginRoot({ notes: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [notes]);
    const plugin = services.plugins.context('notes');

    const err = await plugin
      .operation('outer', {}, async (changes) => {
        await changes.writeFile('dataRoot', 'outer.txt', 'outer');
        await plugin.operation('inner', {}, async (inner) => inner.writeFile('dataRoot', 'inner.txt', 'inner'));
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PluginError);
    expect((err as PluginError).details).toMatchObject({
      plugin: 'notes',
      operation: 'notes.outer',
      stage: 'body',
      nested: 'notes.inner',
    });
    expect(await plugin.files.read('dataRoot', 'outer.txt')).toBeNull();
    expect(await plugin.files.read('dataRoot', 'inner.txt')).toBeNull();
  });

  it('reads stay available inside hooks', async () => {
    const cap = captured();
    const names: string[] = [];
    const reader = definePlugin({
      id: 'reader',
      name: 'Reader',
      description: '',
      hooks: {
        'stories.update': {
          async transform({ plugin }) {
            names.push((await plugin.services.stories.get('WEB-2')).name);
            names.push((await cap.services.boards.get('web')).name);
          },
          async guard({ plugin }) {
            names.push(String((await plugin.services.stories.list('web', {})).length));
          },
          async react({ plugin }) {
            names.push((await plugin.services.stories.get('WEB-1')).name);
          },
        },
      },
    });
    const t = await pluginRoot({ reader: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-2' });
    const { services } = await withPlugins(t, [reader]);
    cap.box.services = services;

    await services.stories.update('WEB-1', { name: 'Outer' });
    expect(names).toEqual(['Story WEB-2', 'Website', '2', 'Outer']);
  });

  it("a replacement's core() runs in the same plan and keeps its core error codes", async () => {
    const replacer = definePlugin({
      id: 'replacer',
      name: 'Replacer',
      description: '',
      replaces: {
        'stories.update': async ({ core, changes }) => {
          const story = await core();
          await changes.writeFile({ story: story.key }, 'replaced.txt', story.name);
          return story;
        },
      },
    });
    const t = await pluginRoot({ replacer: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [replacer]);

    const story = await services.stories.update('WEB-1', { name: 'Replaced' });
    expect(story.name).toBe('Replaced');
    expect(await services.plugins.context('replacer').files.read({ story: 'WEB-1' }, 'replaced.txt')).toBe('Replaced');
    await expect(services.stories.update('WEB-9', { name: 'Missing' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('an unrelated operation proceeds while a background reaction is pending', async () => {
    const reacting = barrier();
    const release = barrier();
    const slow = definePlugin({
      id: 'slow',
      name: 'Slow',
      description: '',
      hooks: {
        'stories.move': {
          async react() {
            reacting.resolve();
            await release.promise;
          },
        },
      },
    });
    const t = await pluginRoot({ slow: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-2' });
    const { services } = await withPlugins(t, [slow], { backgroundReactions: true });

    await services.stories.move('WEB-1', 'todo');
    await reacting.promise;
    // The user acts while the reaction still waits.
    const other = await services.stories.update('WEB-2', { name: 'Meanwhile' });
    expect(other.name).toBe('Meanwhile');
    release.resolve();
    expect((await readJsonFile(t, storyFile('WEB-2'))).name).toBe('Meanwhile');
  });
});

describe('doctor fixes run inside their scope (ARCH-06)', () => {
  it('a doctor fix cannot start a nested operation', async () => {
    const cap = captured();
    const fixer = definePlugin({
      id: 'fixer',
      name: 'Fixer',
      description: '',
      doctor: {
        check: async ({ data }) =>
          data.stories.some((s) => s.name === 'Broken')
            ? [
                {
                  code: 'BROKEN',
                  severity: 'warning',
                  path: 'boards/web/stories/WEB-1/story.json',
                  message: 'broken',
                  async fix() {
                    await cap.services.stories.update('WEB-2', { name: 'From fix' });
                    return 'fixed';
                  },
                },
              ]
            : [],
      },
    });
    const t = await pluginRoot({ fixer: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Broken' });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-2' });
    const { services } = await withPlugins(t, [fixer]);
    cap.box.services = services;

    const err = await services.doctor.fix().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PluginError);
    expect(String((err as Error).message)).toContain('tried to start stories.update during the doctor-fix of doctor.fix');
    expect((await readJsonFile(t, storyFile('WEB-2'))).name).toBe('Story WEB-2');
  });

  it('a doctor fix writer used after the fix returned throws and changes nothing', async () => {
    let kept: { writeFile(scope: 'dataRoot', name: string, text: string): Promise<void> } | undefined;
    const fixer = definePlugin({
      id: 'fixer',
      name: 'Fixer',
      description: '',
      doctor: {
        check: async ({ plugin }) =>
          (await plugin.files.read('dataRoot', 'fixed.txt')) === null
            ? [
                {
                  code: 'MISSING',
                  severity: 'warning',
                  path: 'plugins/fixer/fixed.txt',
                  message: 'missing',
                  async fix(changes) {
                    kept = changes;
                    await changes.writeFile('dataRoot', 'fixed.txt', 'ok');
                    return 'wrote it';
                  },
                },
              ]
            : [],
      },
    });
    const t = await pluginRoot({ fixer: true });
    const { services } = await withPlugins(t, [fixer]);
    await services.doctor.fix();
    await expect(kept?.writeFile('dataRoot', 'late.txt', 'late')).rejects.toThrow(
      'Plugin "fixer" used its Change Set after its doctor-fix of doctor.fix ended',
    );
    expect(await services.plugins.context('fixer').files.read('dataRoot', 'late.txt')).toBeNull();
  });
});
