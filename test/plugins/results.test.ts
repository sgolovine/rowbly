// ARCH-42, §6, W6, W11: callers and reactions get the same final, post-transform result.
import { describe, expect, it } from 'vitest';
import { ConflictError, PluginError } from '../../src/core';
import { definePlugin, type StageConfig, withFixedStages } from '../../src/plugin-api';
import { makeStory } from '../helpers';
import { pluginRoot, readJsonFile, storyFile, withPlugins } from './helpers';

describe('final results (ARCH-42)', () => {
  it('a transform that changes Stages gives caller and reaction the persisted list', async () => {
    const reacted: unknown[] = [];
    const shout = definePlugin({
      id: 'shout',
      name: 'Shout',
      description: '',
      hooks: {
        'stages.add': {
          async transform({ changes }) {
            await changes.updateBoard('web', (board) => ({
              ...board,
              stages: (board.stages ?? []).map((s: StageConfig) => ({ ...s, name: s.name.toUpperCase() })),
            }));
          },
          react: ({ result }) => void reacted.push(result),
        },
      },
    });
    const t = await pluginRoot({ shout: true });
    const { services } = await withPlugins(t, [shout]);

    const stages = await services.stages.add({ level: 'board', boardId: 'web' }, { key: 'qa', name: 'Qa' });
    const persisted = (await readJsonFile(t, 'boards/web/board.config.json')).stages as StageConfig[];
    expect(stages.map((s) => s.name)).toContain('QA');
    expect(stages).toEqual(withFixedStages(persisted));
    expect(reacted).toEqual([withFixedStages(persisted)]);
  });

  it('a transform that changes Local State gives caller and reaction the persisted state', async () => {
    const reacted: unknown[] = [];
    const marker = definePlugin({
      id: 'marker',
      name: 'Marker',
      description: '',
      hooks: {
        'context.use': {
          async transform({ changes, plugin }) {
            await changes.updateLocalState((state) => plugin.writeBag(state, { marked: true }) as typeof state);
          },
          react: ({ result }) => void reacted.push(result),
        },
      },
    });
    const t = await pluginRoot({ marker: true });
    const { services } = await withPlugins(t, [marker]);

    const local = await services.context.use('web');
    const persisted = await readJsonFile(t, 'local.json');
    expect(local).toMatchObject({ board: 'web', plugins: { marker: { marked: true } } });
    expect(local).toEqual(persisted);
    expect(reacted).toEqual([local]);
  });

  it("a Plugin operation's result finalizer reads its own record as other Plugins' transforms left it", async () => {
    const reacted: unknown[] = [];
    const owner = definePlugin({ id: 'owner', name: 'Owner', description: '' });
    const editor = definePlugin({
      id: 'editor',
      name: 'Editor',
      description: '',
      hooks: {
        'owner.make': {
          async transform({ changes }) {
            await changes.updateStory('WEB-1', (s) => ({ ...s, description: 'edited' }));
          },
          react: ({ result }) => void reacted.push(result),
        },
      },
    });
    const t = await pluginRoot({ owner: true, editor: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [owner, editor]);

    const made = await services.plugins
      .context('owner')
      .operation('make', {}, async (changes) => changes.updateStory('WEB-1', (s) => ({ ...s, name: 'Made' })), {
        result: (changes, body) => changes.story(body.key)?.after ?? body,
      });
    const persisted = await readJsonFile(t, storyFile('WEB-1'));
    expect(made).toMatchObject({ name: 'Made', description: 'edited' });
    expect(made).toEqual(persisted);
    expect(reacted).toEqual([persisted]);
  });

  it('a transform that removes the returned Story fails before the save (W11)', async () => {
    const remover = definePlugin({
      id: 'remover',
      name: 'Remover',
      description: '',
      hooks: {
        'stories.create': {
          async transform({ changes, result }) {
            await changes.deleteStory(result.key);
          },
        },
      },
    });
    const t = await pluginRoot({ remover: true });
    const { services } = await withPlugins(t, [remover]);
    const err = await services.stories.create('web', { name: 'Gone' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err).toMatchObject({
      message: 'Plugin "remover" removed Story WEB-1 that stories.create returns',
      details: { plugin: 'remover', operation: 'stories.create', stage: 'transform' },
    });
    expect(await services.stories.list('web', {})).toEqual([]);
  });
});

describe('replacement core() (W6, DX-19)', () => {
  it('a second core() call fails with an attributed PluginError and saves nothing', async () => {
    const twice = definePlugin({
      id: 'twice',
      name: 'Twice',
      description: '',
      replaces: {
        'stories.update': async ({ core }) => {
          await core();
          return core();
        },
      },
    });
    const t = await pluginRoot({ twice: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [twice]);
    const err = await services.stories.update('WEB-1', { name: 'Twice' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PluginError);
    expect(err).toMatchObject({
      message: 'Plugin "twice" called core() twice in its replacement of stories.update',
      details: { plugin: 'twice', operation: 'stories.update', stage: 'replacement' },
    });
    expect((await readJsonFile(t, storyFile('WEB-1'))).name).toBe('Story WEB-1');
  });

  it('a second core() call that the replacement catches still saves nothing', async () => {
    const sly = definePlugin({
      id: 'sly',
      name: 'Sly',
      description: '',
      replaces: {
        'stories.update': async ({ core }) => {
          const story = await core();
          await core().catch(() => undefined);
          return story;
        },
      },
    });
    const t = await pluginRoot({ sly: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [sly]);
    await expect(services.stories.update('WEB-1', { name: 'Sly' })).rejects.toBeInstanceOf(PluginError);
    expect((await readJsonFile(t, storyFile('WEB-1'))).name).toBe('Story WEB-1');
  });

  it('not calling core() is allowed', async () => {
    const skip = definePlugin({
      id: 'skip',
      name: 'Skip',
      description: '',
      replaces: { 'stories.update': async ({ input, plugin }) => plugin.services.stories.get(input.key) },
    });
    const t = await pluginRoot({ skip: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [skip]);
    expect((await services.stories.update('WEB-1', { name: 'Ignored' })).name).toBe('Story WEB-1');
  });
});
