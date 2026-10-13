import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRepositories } from '../../src/storage';
import { FIXED_NOW, makeBoard, makeStory } from '../helpers';
import { notes } from './fixtures';
import { pluginRoot, readJsonFile, storyFile, withPlugins } from './helpers';

/** The bag of a Plugin that this Rowbly version does not know. */
const GHOST = { ghost: { deep: { list: [1, 2] }, flag: true } };
const stamps = { createdAt: FIXED_NOW, updatedAt: FIXED_NOW };
const comment = (id: string) => ({ id, author: null, body: 'Hi', ...stamps, plugins: GHOST });

/** Every kind of record, each with a ghost bag; Notes is off. */
async function bagged() {
  const t = await pluginRoot(
    {},
    {
      assignees: [
        { handle: 'alice', name: 'Alice', plugins: GHOST },
        { handle: 'bob', name: 'Bob', plugins: GHOST },
      ],
      customFields: [{ key: 'size', name: 'Size', type: 'text', required: false }],
      plugins: { ghost: { enabled: false, setting: 1 }, notes: { enabled: false, marker: 'm' } },
    },
  );
  await makeBoard(t.path, { id: 'web', name: 'Website', keyPrefix: 'WEB', plugins: GHOST });
  await writeFile(join(t.path, 'local.json'), `${JSON.stringify({ version: 1, plugins: GHOST })}\n`);
  await makeStory(t.path, {
    boardId: 'web',
    key: 'WEB-1',
    assignees: ['alice', 'bob'],
    customFields: { size: 's' },
    plugins: { ...GHOST, notes: { note: 'kept while off' } },
    comments: [comment('c1')],
    tasks: [
      {
        id: 'WEB-1.1',
        name: 'T',
        description: '',
        stage: 'backlog',
        comments: [comment('c2')],
        ...stamps,
        plugins: GHOST,
      },
    ],
    nextTaskNumber: 2,
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
    await services.tasks.create('WEB-1', { name: 'New' });
    await services.tasks.update('WEB-1.1', { name: 'T2' });
    await services.tasks.move('WEB-1.1', 'done');
    await services.comments.add('WEB-1', 'Another');
    await services.comments.update('WEB-1', 'c1', 'Edited');
    await services.comments.update('WEB-1.1', 'c2', 'Edited');
    await services.boards.update('web', { description: 'Changed' });
    await services.assignees.update('alice', { name: 'Alice A' });
    await services.assignees.remove('bob');
    await services.stages.remove({ level: 'global' }, 'backlog', { moveTo: 'todo' });
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
    const [task] = story.tasks as { plugins: unknown; comments: { plugins: unknown }[] }[];
    expect(task?.plugins).toEqual(GHOST);
    expect(task?.comments[0]?.plugins).toEqual(GHOST);
    expect((story.comments as { plugins?: unknown }[])[0]?.plugins).toEqual(GHOST);

    const root = await readJsonFile(t, 'rowbly.config.json');
    expect(root.assignees).toEqual([{ handle: 'alice', name: 'Alice A', plugins: GHOST }]);
    expect(root.plugins).toEqual({ ghost: { enabled: false, setting: 1 }, notes: { enabled: false, marker: 'm' } });
    expect((await readJsonFile(t, 'boards/web/board.config.json')).plugins).toEqual(GHOST);
    expect(await readJsonFile(t, 'local.json')).toEqual({ version: 1, board: 'web', me: 'alice', plugins: GHOST });
  });

  it('are read back exactly as stored, so --json prints them', async () => {
    const t = await bagged();
    const { services } = await withPlugins(t, [notes]);
    expect((await services.stories.get('WEB-1')).plugins).toEqual({ ...GHOST, notes: { note: 'kept while off' } });
    expect((await services.assignees.list())[0]?.plugins).toEqual(GHOST);
    expect((await services.boards.get('web')).plugins).toEqual(GHOST);
  });
});
