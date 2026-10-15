// RES-06, ARCH-23, ARCH-39: hooks see detached, frozen snapshots; writers live as long as their stage (ADR-0020 §1, D3).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PluginError } from '../../src/core';
import { type Change, type ChangeSetView, definePlugin, type PluginChangeSet, type Story } from '../../src/plugin-api';
import { makeStory } from '../helpers';
import { pluginRoot, readJsonFile, storyFile, withPlugins } from './helpers';

/** Calls `fn` and keeps what it threw, or `undefined`. */
async function thrown(fn: () => unknown): Promise<unknown> {
  try {
    await fn();
    return undefined;
  } catch (err) {
    return err;
  }
}

describe('snapshots cannot reach the plan (RES-06)', () => {
  it("changing before.key in a remove transform cannot redirect the deletion (extra.ts)", async () => {
    const attempts: unknown[] = [];
    const corrupt = definePlugin({
      id: 'corrupt',
      name: 'Corrupt',
      description: '',
      hooks: {
        'stories.remove': {
          transform({ changes }) {
            const change = changes.story('WEB-1') as Change & { before: Story };
            attempts.push(thrown(() => Object.assign(change.before, { key: 'WEB-2' })));
          },
        },
      },
    });
    const t = await pluginRoot({ corrupt: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-2' });
    const { services } = await withPlugins(t, [corrupt]);

    await services.stories.remove('WEB-1');
    expect(await Promise.all(attempts)).toEqual([expect.any(TypeError)]);
    expect((await services.stories.list('web', {})).map((s) => s.key)).toEqual(['WEB-2']);
  });

  it('pushing onto or editing view arrays has no effect on disk or on other hooks', async () => {
    const seen: string[] = [];
    const pusher = definePlugin({
      id: 'pusher',
      name: 'Pusher',
      description: '',
      hooks: {
        'stories.update': {
          async transform({ changes }) {
            const list = changes.changes as Change[];
            await thrown(() =>
              list.push({ type: 'file', plugin: 'pusher', path: 'hijacked.txt', before: null, after: 'x' }),
            );
            const story = changes.story('WEB-1')?.after as Story;
            await thrown(() => (story.labels as string[]).push('hacked'));
            await thrown(() => Object.assign(story, { name: 'Hacked' }));
          },
        },
      },
    });
    const watcher = definePlugin({
      id: 'watcher',
      name: 'Watcher',
      description: '',
      hooks: {
        'stories.update': {
          transform({ changes }) {
            seen.push(`${changes.changes.length}:${changes.story('WEB-1')?.after?.name}:${changes.story('WEB-1')?.after?.labels.length}`);
          },
        },
      },
    });
    const t = await pluginRoot({ pusher: true, watcher: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [pusher, watcher]);

    await services.stories.update('WEB-1', { name: 'Renamed' });
    expect(seen).toEqual(['1:Renamed:0']);
    const disk = await readJsonFile(t, storyFile('WEB-1'));
    expect(disk).toMatchObject({ name: 'Renamed', labels: [] });
    expect(existsSync(join(t.path, 'hijacked.txt'))).toBe(false);
  });

  it('an update callback that changes its copy and then throws leaves the pending record intact', async () => {
    const poison = definePlugin({
      id: 'poison',
      name: 'Poison',
      description: '',
      hooks: {
        'stories.update': {
          async transform({ changes }) {
            await thrown(() =>
              changes.updateStory('WEB-1', (story) => {
                story.name = 'Poisoned';
                story.labels.push('poison');
                throw new Error('changed my mind');
              }),
            );
          },
        },
      },
    });
    const t = await pluginRoot({ poison: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [poison]);

    const story = await services.stories.update('WEB-1', { name: 'Renamed' });
    expect(story).toMatchObject({ name: 'Renamed', labels: [] });
    expect(await readJsonFile(t, storyFile('WEB-1'))).toMatchObject({ name: 'Renamed', labels: [] });
  });

  it('a record a Plugin puts and keeps a reference to cannot be changed afterwards', async () => {
    const keeper = definePlugin({
      id: 'keeper',
      name: 'Keeper',
      description: '',
      hooks: {
        'stories.update': {
          async transform({ changes }) {
            const story = structuredClone(changes.story('WEB-1')?.after) as Story;
            story.description = 'from keeper';
            await changes.putStory(story);
            story.description = 'changed later';
          },
        },
      },
    });
    const t = await pluginRoot({ keeper: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [keeper]);
    await services.stories.update('WEB-1', { name: 'Renamed' });
    expect((await readJsonFile(t, storyFile('WEB-1'))).description).toBe('from keeper');
  });

  it("accessors return the current snapshot, so a transform sees its own later writes; before stays the original", async () => {
    const seen: unknown[] = [];
    const writer = definePlugin({
      id: 'writer',
      name: 'Writer',
      description: '',
      hooks: {
        'stories.update': {
          async transform({ changes }) {
            const first = changes.story('WEB-1');
            await changes.updateStory('WEB-1', (s) => ({ ...s, description: 'later' }));
            const second = changes.story('WEB-1');
            seen.push(first?.after?.description, second?.after?.description, second?.before?.name, Object.isFrozen(second));
          },
        },
      },
    });
    const t = await pluginRoot({ writer: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [writer]);
    await services.stories.update('WEB-1', { name: 'Renamed' });
    expect(seen).toEqual(['', 'later', 'Story WEB-1', true]);
  });

  it('hooks get a frozen input, so one hook cannot change the input another sees', async () => {
    const seen: unknown[] = [];
    const a = definePlugin({
      id: 'a',
      name: 'A',
      description: '',
      hooks: {
        'stories.update': {
          async transform({ input }) {
            seen.push(await thrown(() => Object.assign(input, { name: 'Changed' })));
          },
        },
      },
    });
    const b = definePlugin({
      id: 'b',
      name: 'B',
      description: '',
      hooks: { 'stories.update': { transform: ({ input }) => void seen.push(input.name) } },
    });
    const t = await pluginRoot({ a: true, b: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [a, b]);
    await services.stories.update('WEB-1', { name: 'Renamed' });
    expect(seen).toEqual([expect.any(TypeError), 'Renamed']);
  });
});

describe('guards (ARCH-39)', () => {
  it('a guard that mutates changes.changes cannot change the persisted Story', async () => {
    const meddler = definePlugin({
      id: 'meddler',
      name: 'Meddler',
      description: '',
      hooks: {
        'stories.update': {
          guard({ changes }) {
            const change = changes.changes[0] as { after: { name: string } };
            try {
              change.after.name = 'Changed by guard';
            } catch {
              // frozen
            }
          },
        },
      },
    });
    const t = await pluginRoot({ meddler: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [meddler]);
    await services.stories.update('WEB-1', { name: 'Renamed' });
    expect((await readJsonFile(t, storyFile('WEB-1'))).name).toBe('Renamed');
  });

  it('a guard gets no writers at run time, but can read pending Plugin files', async () => {
    const seen: unknown[] = [];
    const inspector = definePlugin({
      id: 'inspector',
      name: 'Inspector',
      description: '',
      hooks: {
        'stories.update': {
          async transform({ changes }) {
            await changes.writeFile({ story: 'WEB-1' }, 'note.txt', 'pending');
          },
          async guard({ changes }) {
            const loose = changes as unknown as Record<string, unknown>;
            seen.push(typeof loose.putStory, typeof loose.updateStory, typeof loose.writeFile);
            seen.push(await changes.readFile({ story: 'WEB-1' }, 'note.txt'));
          },
        },
      },
    });
    const t = await pluginRoot({ inspector: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [inspector]);
    await services.stories.update('WEB-1', { name: 'Renamed' });
    expect(seen).toEqual(['undefined', 'undefined', 'undefined', 'pending']);
  });

  it('later guards see the same snapshot the earlier guard saw', async () => {
    const views: unknown[] = [];
    const first = definePlugin({
      id: 'first',
      name: 'First',
      description: '',
      hooks: { 'stories.update': { guard: ({ changes }) => void views.push(changes.changes) } },
    });
    const second = definePlugin({
      id: 'second',
      name: 'Second',
      description: '',
      hooks: { 'stories.update': { guard: ({ changes }) => void views.push(changes.changes) } },
    });
    const t = await pluginRoot({ first: true, second: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [first, second]);
    await services.stories.update('WEB-1', { name: 'Renamed' });
    expect(views[0]).toBe(views[1]);
    expect(Object.isFrozen(views[0])).toBe(true);
  });
});

describe('writer lifetime (D3)', () => {
  it.each(['guard', 'react', 'later'] as const)(
    'a transform writer used from a %s throws without changing the plan',
    async (when) => {
      let kept: PluginChangeSet | undefined;
      const errors: unknown[] = [];
      const use = async () => {
        errors.push(await thrown(() => kept?.updateStory('WEB-1', (s) => ({ ...s, description: 'retained' }))));
      };
      const retainer = definePlugin({
        id: 'retainer',
        name: 'Retainer',
        description: '',
        hooks: {
          'stories.update': {
            transform({ changes }) {
              kept = changes;
            },
            ...(when === 'guard' ? { guard: use } : {}),
            ...(when === 'react' ? { react: use } : {}),
          },
        },
      });
      const t = await pluginRoot({ retainer: true });
      await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
      const { services } = await withPlugins(t, [retainer]);
      await services.stories.update('WEB-1', { name: 'Renamed' });
      if (when === 'later') await use();

      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(PluginError);
      expect((errors[0] as Error).message).toBe(
        'Plugin "retainer" used its Change Set after its transform of stories.update ended',
      );
      expect(await readJsonFile(t, storyFile('WEB-1'))).toMatchObject({ name: 'Renamed', description: '' });
    },
  );

  it('a late continuation of a transform cannot change the plan', async () => {
    let late: Promise<unknown> | undefined;
    const detached = definePlugin({
      id: 'detached',
      name: 'Detached',
      description: '',
      hooks: {
        'stories.update': {
          transform({ changes }) {
            late = new Promise((resolve) => setTimeout(resolve, 0)).then(() =>
              thrown(() => changes.writeFile('dataRoot', 'late.txt', 'late')),
            );
          },
        },
      },
    });
    const t = await pluginRoot({ detached: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [detached]);
    await services.stories.update('WEB-1', { name: 'Renamed' });
    expect(await late).toBeInstanceOf(PluginError);
    expect(await services.plugins.context('detached').files.read('dataRoot', 'late.txt')).toBeNull();
  });
});

describe('reactions (ARCH-23)', () => {
  it("reaction A's mutation attempt cannot change reaction B's event; reactions see final transformed data", async () => {
    const seen: unknown[] = [];
    const views: ChangeSetView[] = [];
    const stamp = definePlugin({
      id: 'stamper',
      name: 'Stamper',
      description: '',
      hooks: {
        'stories.update': {
          async transform({ changes }) {
            await changes.updateStory('WEB-1', (s) => ({ ...s, description: 'stamped' }));
          },
        },
      },
    });
    const a = definePlugin({
      id: 'a',
      name: 'A',
      description: '',
      hooks: {
        'stories.update': {
          async react({ changes, result }) {
            views.push(changes);
            seen.push(await thrown(() => Object.assign(changes.story('WEB-1')?.after ?? {}, { name: 'A' })));
            seen.push(await thrown(() => Object.assign(result, { name: 'A' })));
          },
        },
      },
    });
    const b = definePlugin({
      id: 'b',
      name: 'B',
      description: '',
      hooks: {
        'stories.update': {
          react({ changes, result }) {
            views.push(changes);
            const after = changes.story('WEB-1')?.after;
            seen.push(after?.name, after?.description, result.name, result.description);
          },
        },
      },
    });
    const t = await pluginRoot({ stamper: true, a: true, b: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [stamp, a, b]);
    const story = await services.stories.update('WEB-1', { name: 'Renamed' });

    expect(seen).toEqual([expect.any(TypeError), expect.any(TypeError), 'Renamed', 'stamped', 'Renamed', 'stamped']);
    expect(views[0]?.changes).toBe(views[1]?.changes);
    expect(story).toMatchObject({ name: 'Renamed', description: 'stamped' });
    expect(await readJsonFile(t, storyFile('WEB-1'))).toMatchObject({ name: 'Renamed', description: 'stamped' });
  });
});
