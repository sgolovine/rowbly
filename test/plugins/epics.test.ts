import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { definePlugin } from '../../src/plugin-api';
import { epics } from '../../src/plugins/epics';
import {
  createEpic,
  deleteEpic,
  editEpic,
  getEpic,
  listEpics,
  setEpicClosed,
  showEpic,
} from '../../src/plugins/epics/service';
import { FIXED_NOW, fixedClock, makeBoard, makeStory } from '../helpers';
import { pluginRoot, pluginTestHost, readJsonFile, withPlugins } from './helpers';

async function setup() {
  const clock = fixedClock();
  const loaded = await pluginTestHost({ plugins: [epics], now: clock.now });
  return { ...loaded, clock, plugin: loaded.context('epics') };
}

describe('Epics operations', () => {
  it('creates, edits, closes and reopens files with validated data and timestamps', async () => {
    const { t, plugin, clock } = await setup();
    const epic = await createEpic(plugin, { id: 'auth', name: 'Authentication' });
    expect(epic).toEqual({
      version: 1,
      id: 'auth',
      name: 'Authentication',
      description: '',
      closed: false,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    });
    expect(await readJsonFile(t, 'plugins/epics/auth.json')).toEqual(epic);
    await expect(createEpic(plugin, { id: 'auth', name: 'Duplicate' })).rejects.toThrow('already exists');
    await expect(createEpic(plugin, { id: '../outside', name: 'Bad' })).rejects.toThrow('Invalid Epic: id: ');
    await expect(createEpic(plugin, { id: 'empty', name: '  ' })).rejects.toThrow('Invalid Epic: name: ');
    await expect(editEpic(plugin, 'auth', { name: ' ' })).rejects.toThrow('Invalid Epic patch: name: ');
    clock.set('2026-10-13T17:21:07.000Z');
    expect(await editEpic(plugin, 'auth', { description: 'Login', name: undefined })).toMatchObject({
      name: 'Authentication',
      description: 'Login',
      createdAt: FIXED_NOW,
      updatedAt: '2026-10-13T17:21:07.000Z',
    });
    expect(await editEpic(plugin, 'auth', { name: 'Access' })).toMatchObject({ name: 'Access', description: 'Login' });
    await setEpicClosed(plugin, 'auth', true);
    expect(await listEpics(plugin)).toEqual([]);
    expect((await listEpics(plugin, 'closed')).map((e) => e.id)).toEqual(['auth']);
    expect(await setEpicClosed(plugin, 'auth', false)).toMatchObject({ closed: false });
    expect(await listEpics(plugin, 'all')).toHaveLength(1);
    await expect(getEpic(plugin, 'missing')).rejects.toThrow('not found');
    await expect(editEpic(plugin, 'missing', { name: 'No' })).rejects.toThrow('not found');
    await writeFile(join(t.path, 'plugins/epics/auth.json'), '{');
    await expect(getEpic(plugin, 'auth')).rejects.toThrow('plugins/epics/auth.json: file is not valid JSON');
  });

  it('links and unlinks through Story operations; preserves other Plugin Data and rejects missing Epics without a save', async () => {
    const { t, plugin, services } = await setup();
    await createEpic(plugin, { id: 'auth', name: 'Auth' });
    const story = await services.stories.create('web', { name: 'Login', plugins: { epics: { epic: 'auth' } } });
    expect(story.plugins).toEqual({ epics: { epic: 'auth' } });
    await makeStory(t.path, { ...story, plugins: { ...story.plugins, other: { keep: true } } });
    const before = await readFile(join(t.path, 'boards/web/stories/WEB-1/story.json'), 'utf8');
    await expect(
      services.stories.update('web-1', { name: 'Rejected', plugins: { epics: { epic: 'missing' } } }),
    ).rejects.toThrow('not found');
    expect(await readFile(join(t.path, 'boards/web/stories/WEB-1/story.json'), 'utf8')).toBe(before);
    await expect(
      services.stories.create('web', { name: 'Rejected', plugins: { epics: { epic: 'missing' } } }),
    ).rejects.toThrow('not found');
    expect(await services.stories.list(null, {})).toHaveLength(1);
    const unlinked = await services.stories.update(story.key, { plugins: { epics: { epic: null } } });
    expect(unlinked.plugins).toEqual({ other: { keep: true } });
    expect((await services.stories.list(null, { plugins: { epics: false } })).map((s) => s.key)).toEqual(['WEB-1']);
    await services.stories.update(story.key, { plugins: { epics: { epic: 'auth' } } });
    expect(await services.stories.list(null, { plugins: { epics: 'auth' } })).toHaveLength(1);
    await expect(services.stories.update(story.key, { plugins: { epics: { epic: 'Not A Slug' } } })).rejects.toThrow(
      'Plugin "epics" input of stories.update is not valid: epic: ',
    );
    for (const filter of [{ epic: 'auth' }, 3, 'Not A Slug', true]) {
      await expect(services.stories.list(null, { plugins: { epics: filter } })).rejects.toMatchObject({
        code: 'VALIDATION',
        message: expect.stringContaining('Plugin "epics" filter is not valid'),
      });
    }
    expect(await services.stories.list(null, { plugins: {} })).toHaveLength(1);
  });

  it('derives Epic Progress across Boards using their Stage Categories, including empty and closed Epics', async () => {
    const { t, plugin, services } = await setup();
    await createEpic(plugin, { id: 'auth', name: 'Auth' });
    expect((await showEpic(plugin, 'auth')).progress).toEqual({ done: 0, total: 0, percent: 0 });
    await makeBoard(t.path, {
      id: 'api',
      name: 'API',
      keyPrefix: 'API',
      stages: [{ key: 'waiting', name: 'Waiting' }],
    });
    await services.stories.create('web', { name: 'Login', plugins: { epics: { epic: 'auth' } } });
    const api = await services.stories.create('api', {
      name: 'Endpoint',
      stage: 'done',
      plugins: { epics: { epic: 'auth' } },
    });
    await services.stories.create('api', { name: 'Unlinked' });
    await setEpicClosed(plugin, 'auth', true);
    const detail = await showEpic(plugin, 'auth');
    expect(detail.progress).toEqual({ done: 1, total: 2, percent: 50 });
    expect(detail.boards.map(({ board, stories }) => [board.id, stories.map((s) => s.key)])).toEqual([
      ['api', ['API-1']],
      ['web', ['WEB-1']],
    ]);
    await services.stories.move(api.key, 'waiting');
    expect((await showEpic(plugin, 'auth')).progress.done).toBe(0);
    expect(await readJsonFile(t, 'plugins/epics/auth.json')).not.toHaveProperty('progress');
  });

  it('deletion unlinks Stories across Boards in one guarded operation and warns only after saving', async () => {
    const blocker = definePlugin({
      id: 'blocker',
      name: 'Blocker',
      description: '',
      hooks: {
        'epics.delete': { guard: () => ({ reject: 'keep the Epic' }) },
      },
    });
    const t = await pluginRoot({ epics: true, blocker: true });
    const blocked = await withPlugins(t, [epics, blocker]);
    const plugin = blocked.services.plugins.context('epics');
    await createEpic(plugin, { id: 'auth', name: 'Auth' });
    await makeBoard(t.path, { id: 'api', keyPrefix: 'API' });
    await makeStory(t.path, {
      key: 'WEB-1',
      boardId: 'web',
      plugins: { epics: { epic: 'auth' }, other: { keep: true } },
    });
    await makeStory(t.path, { key: 'API-1', boardId: 'api', plugins: { epics: { epic: 'auth' } } });
    await expect(deleteEpic(plugin, 'auth')).rejects.toThrow('keep the Epic');
    expect((await blocked.services.stories.get('WEB-1')).plugins?.epics).toEqual({ epic: 'auth' });
    expect(await getEpic(plugin, 'auth')).toMatchObject({ id: 'auth' });
    expect(blocked.warnings).toEqual([]);
    const allowed = await withPlugins(t, [epics]);
    expect(await deleteEpic(allowed.services.plugins.context('epics'), 'auth')).toEqual({
      id: 'auth',
      storiesUnlinked: 2,
    });
    expect((await allowed.services.stories.get('WEB-1')).plugins).toEqual({ other: { keep: true } });
    expect(await allowed.services.stories.get('API-1')).not.toHaveProperty('plugins');
    expect(allowed.warnings).toEqual(['Unlinked 2 Stories from Epic "auth"']);
    await expect(getEpic(allowed.services.plugins.context('epics'), 'auth')).rejects.toThrow('not found');
  });
});
