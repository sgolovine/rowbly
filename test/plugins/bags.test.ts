import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRepositories } from '../../src/storage';
import { makeBoard, makeStory } from '../helpers';
import { notes } from './fixtures';
import { pluginRoot, readJsonFile, storyFile, withPlugins } from './helpers';

/** The bag of a Plugin that this Rowbly version does not know. */
const GHOST = { ghost: { deep: { list: [1, 2] }, flag: true } };

/** Every kind of record, each with a ghost bag; Notes is off. */
async function bagged() {
  const t = await pluginRoot(
    {},
    {
      customFields: [{ key: 'size', name: 'Size', type: 'text', required: false }],
      plugins: { ghost: { enabled: false, setting: 1 }, notes: { enabled: false, marker: 'm' } },
    },
  );
  await makeBoard(t.path, { id: 'web', name: 'Website', keyPrefix: 'WEB', plugins: GHOST });
  await writeFile(join(t.path, 'local.json'), `${JSON.stringify({ version: 1, plugins: GHOST })}\n`);
  await makeStory(t.path, {
    boardId: 'web',
    key: 'WEB-1',
    customFields: { size: 's' },
    plugins: { ...GHOST, notes: { note: 'kept while off' } },
  });
  await makeStory(t.path, { boardId: 'web', key: 'WEB-2', rank: 'a1' });
  return t;
}

describe('Plugin Data is kept unchanged by core (ADR-0011)', () => {
  it('through every core operation, for Plugins that are off or unknown', async () => {
    const t = await bagged();
    // Local State as a run reads it from local.json.
    const local = await createRepositories(t.root).localState.get();
    const { services } = await withPlugins(t, [notes], { local });
    await services.stories.update('WEB-1', { name: 'Renamed', labels: ['x'] });
    await services.stories.move('WEB-1', 'todo');
    await services.stories.rank('WEB-1', 'bottom');
    await services.boards.update('web', { description: 'Changed' });
    await services.stages.remove({ level: 'global' }, 'in-progress', { moveTo: 'todo' });
    await services.fields.remove({ level: 'global' }, 'size');
    await services.context.use('web');
    await services.context.setMe('alice');
    await services.doctor.fix();

    const story = await readJsonFile(t, storyFile('WEB-1'));
    expect(story).toMatchObject({
      name: 'Renamed',
      stage: 'todo',
      plugins: { ...GHOST, notes: { note: 'kept while off' } },
    });

    const root = await readJsonFile(t, 'rowbly.config.json');
    expect(root.plugins).toEqual({ ghost: { enabled: false, setting: 1 }, notes: { enabled: false, marker: 'm' } });
    expect((await readJsonFile(t, 'boards/web/board.config.json')).plugins).toEqual(GHOST);
    expect(await readJsonFile(t, 'local.json')).toEqual({ version: 1, board: 'web', me: 'alice', plugins: GHOST });
  });
});

it('reconciles only supported owned formats while Off, preserves future bags and refuses out-of-scope output before saving', async () => {
  const { definePlugin, z } = await import('../../src/plugin-api');
  const { mergeData } = await import('../../src/services/plugins/mergeData');
  const t = await bagged();
  const file = (v: unknown) => ({
    data: Buffer.from(`${JSON.stringify(v)}\n`).toString('base64'),
    mode: '100644' as const,
  });
  const root = await readJsonFile(t, 'rowbly.config.json'),
    board = await readJsonFile(t, 'boards/web/board.config.json');
  const story = (await import('../../src/schemas')).StorySchema.parse(await readJsonFile(t, storyFile('WEB-1')));
  const path = storyFile('WEB-1');
  const base = {
    id: 'base',
    files: { 'rowbly.config.json': file(root), 'boards/web/board.config.json': file(board), [path]: file(story) },
  };
  const left = {
    id: 'left',
    files: {
      ...base.files,
      [path]: file({
        ...story,
        plugins: {
          ...story.plugins,
          format: { version: 1, count: 1 },
          future: { version: 100, list: ['left'], raw: null },
        },
      }),
    },
  };
  const right = {
    id: 'right',
    files: {
      ...base.files,
      [path]: file({
        ...story,
        plugins: {
          ...story.plugins,
          format: { version: 1, count: 2 },
          future: { version: 100, list: ['right'], bytes: 'unchanged' },
        },
      }),
    },
  };
  let started = 0,
    called = 0;
  const format = definePlugin({
    id: 'format',
    name: 'Format',
    description: '',
    bags: { story: z.strictObject({ version: z.literal(1), count: z.number() }) },
    start() {
      started++;
    },
    reconcile({ left, right, helpers }) {
      called++;
      expect(Object.keys(left.bags)).toEqual(['boards/web/stories/WEB-1']);
      expect(left.bags['boards/web/stories/WEB-1']).toEqual({ version: 1, count: 1 });
      expect(() => {
        left.bags.bad = 1;
      }).toThrow();
      expect(helpers.same(right.bags['boards/web/stories/WEB-1'], { version: 1, count: 2 })).toBe(true);
      return { bags: { 'boards/web/stories/WEB-1': { version: 1, count: 3 } }, files: {} };
    },
  });
  const result = mergeData(base, left, right, [format]);
  const merged = JSON.parse(Buffer.from(result.files[path]?.data ?? '', 'base64').toString());
  expect(merged.plugins.format).toEqual({ version: 1, count: 3 });
  expect(merged.plugins.future).toMatchObject({ version: 100, raw: null, bytes: 'unchanged' });
  expect(merged.plugins.ghost).toEqual(story.plugins?.ghost);
  expect(started).toBe(0);
  expect(called).toBe(1);
  expect(result.evidence).toHaveLength(1);
  for (const reconcile of [
    () => ({ bags: {}, files: { 'plugins/other/data.json': file({ corrupt: true }) } }),
    () => ({ bags: { 'boards/missing/stories/MIS-1': {} }, files: {} }),
    () => ({ bags: {}, files: {}, requiredStories: [{ source: 'left', key: 'WEB-999' }] }),
    () => ({ bags: {}, files: {}, requiredStages: [{ source: 'left', board: 'web', key: 'missing' }] }),
    () => {
      throw new Error('format failed');
    },
  ])
    expect(() => mergeData(base, left, right, [{ ...format, reconcile }])).toThrow();
  expect(await readJsonFile(t, path)).toEqual(story);
});
