import { describe, expect, it } from 'vitest';
import { definePlugin } from '../../src/plugin-api';
import { epics } from '../../src/plugins/epics';
import { createEpic } from '../../src/plugins/epics/service';
import { makeStory } from '../helpers';
import { pluginRoot, withPlugins } from './helpers';

describe('Epics doctor', () => {
  it('warns for missing Epics and fixes their links while preserving other Plugin Data', async () => {
    const t = await pluginRoot({ epics: true });
    await makeStory(t.path, {
      key: 'WEB-1',
      boardId: 'web',
      plugins: { epics: { epic: 'missing' }, other: { keep: true } },
    });
    await makeStory(t.path, { key: 'WEB-2', boardId: 'web', rank: 'a1', plugins: { epics: { epic: 'auth' } } });
    const { services } = await withPlugins(t, [epics]);
    await createEpic(services.plugins.context('epics'), { id: 'auth', name: 'Auth' });
    const finding = (await services.doctor.check()).findings.find((f) => f.code === 'EPICS_MISSING_EPIC');
    expect(finding).toMatchObject({ severity: 'warning', fixable: true, path: 'boards/web/stories/WEB-1/story.json' });
    expect((await services.doctor.fix()).fixed).toContainEqual({
      code: 'EPICS_MISSING_EPIC',
      path: 'boards/web/stories/WEB-1/story.json',
      message: 'unlinked WEB-1 from missing Epic "missing"',
    });
    expect((await services.stories.get('WEB-1')).plugins).toEqual({ other: { keep: true } });
    expect((await services.stories.get('WEB-2')).plugins).toEqual({ epics: { epic: 'auth' } });
    expect((await services.doctor.check()).findings.some((f) => f.code === 'EPICS_MISSING_EPIC')).toBe(false);
  });

  it('fixes run through operations and disabled Plugin Data stays unchanged', async () => {
    const t = await pluginRoot({ epics: true, keep: true });
    await makeStory(t.path, { key: 'WEB-1', boardId: 'web', plugins: { epics: { epic: 'missing' } } });
    const keep = definePlugin({
      id: 'keep',
      name: 'Keep',
      description: '',
      hooks: { 'doctor.fix': { guard: () => ({ reject: 'keep links' }) } },
    });
    const { services } = await withPlugins(t, [epics, keep]);
    await expect(services.doctor.fix()).rejects.toThrow('keep links');
    expect((await services.stories.get('WEB-1')).plugins).toEqual({ epics: { epic: 'missing' } });
    await services.plugins.disable('epics');
    const off = await withPlugins(t, [epics]);
    expect((await off.services.doctor.fix()).findings.map((f) => f.code)).toContain('PLUGIN_DATA_UNCHECKED');
    expect((await off.services.stories.get('WEB-1')).plugins).toEqual({ epics: { epic: 'missing' } });
  });
});
