import { describe, expect, it, vi } from 'vitest';
import { epics } from '../../src/plugins/epics';
import { createEpic, listEpicSummaries, setEpicClosed, showEpic } from '../../src/plugins/epics/service';
import { makeBoard, makeStory } from '../helpers';
import { pluginRoot, withPlugins } from './helpers';

/**
 * Two Boards with different Stage keys and categories, open and closed Epics, an empty Epic, Stories
 * of each Epic on both Boards, and bags of a disabled (Specs) and an unknown Plugin.
 */
async function seed() {
  const t = await pluginRoot({}, { plugins: { epics: { enabled: true }, specs: { enabled: false } } });
  await makeBoard(t.path, {
    id: 'api',
    name: 'API',
    keyPrefix: 'API',
    stages: [
      { key: 'waiting', name: 'Waiting', category: 'todo' },
      { key: 'shipped', name: 'Shipped', category: 'done' },
      { key: 'done', name: 'Not really done', category: 'in_progress' },
    ],
  });
  const { services } = await withPlugins(t, [epics]);
  const plugin = services.plugins.context('epics');
  for (const id of ['auth', 'billing', 'empty', 'old']) await createEpic(plugin, { id, name: id });
  await setEpicClosed(plugin, 'old', true);
  const other = { specs: { specs: ['x'] }, unknown: { anything: [1, 2] } };
  let rank = 0;
  const story = (key: string, boardId: string, stage: string, epic?: string) =>
    makeStory(t.path, {
      key,
      boardId,
      stage,
      rank: `a${rank++}`,
      plugins: { ...other, ...(epic ? { epics: { epic } } : {}) },
    });
  await story('WEB-1', 'web', 'done', 'auth');
  await story('WEB-2', 'web', 'todo', 'auth');
  await story('API-1', 'api', 'shipped', 'auth');
  await story('API-2', 'api', 'done', 'billing');
  await story('WEB-3', 'web', 'done', 'billing');
  await story('WEB-4', 'web', 'done', 'old');
  await story('API-3', 'api', 'waiting');
  return { t, services, plugin };
}

describe('Epic summaries (PERF-01)', () => {
  it.each(['open', 'closed', 'all'] as const)(
    'lists Stories once and each Board configuration once, and matches showEpic (%s)',
    async (mode) => {
      const { services, plugin } = await seed();
      const list = vi.spyOn(services.stories, 'list');
      const effective = vi.spyOn(services.config, 'effective');
      const { summaries, unavailable } = await listEpicSummaries(plugin, mode);
      expect(list).toHaveBeenCalledTimes(1);
      expect(new Set(effective.mock.calls.map(([board]) => board)).size).toBe(effective.mock.calls.length);
      expect(unavailable).toEqual([]);
      const expected = {
        open: ['auth', 'billing', 'empty'],
        closed: ['old'],
        all: ['auth', 'billing', 'empty', 'old'],
      };
      expect(summaries.map((s) => s.id)).toEqual(expected[mode]);
      list.mockRestore();
      for (const summary of summaries) {
        const { boards, ...detail } = await showEpic(plugin, summary.id);
        expect(summary).toEqual(detail);
      }
    },
  );

  it('counts done Stories by each Board’s Stage Categories', async () => {
    const { plugin } = await seed();
    const { summaries } = await listEpicSummaries(plugin, 'all');
    expect(Object.fromEntries(summaries.map((s) => [s.id, s.progress]))).toEqual({
      auth: { done: 2, total: 3, percent: 67 },
      billing: { done: 1, total: 2, percent: 50 },
      empty: { done: 0, total: 0, percent: 0 },
      old: { done: 1, total: 1, percent: 100 },
    });
  });

  it('does not grow its Story reads with the number of Epics', async () => {
    const { services, plugin } = await seed();
    for (let i = 0; i < 20; i++) await createEpic(plugin, { id: `more-${i}`, name: `More ${i}` });
    const list = vi.spyOn(services.stories, 'list');
    expect((await listEpicSummaries(plugin, 'open')).summaries).toHaveLength(23);
    expect(list).toHaveBeenCalledTimes(1);
  });
});
