import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError, UsageError, ValidationError } from '../../src/core';
import { DEFAULT_STAGES, type Stage } from '../../src/schemas';
import { createServices, type RowblyContext } from '../../src/services';
import { affectedBoards, readLevel } from '../../src/services/_configTarget';
import { createRepositories } from '../../src/storage';
import { fixedClock, fixedIds, makeBoard, makeStory, type TempRoot, tempRoot } from '../helpers';

const keys = (stages: Stage[]) => stages.map((s) => s.key);

function contextFor(t: TempRoot): RowblyContext {
  return { root: t.root, local: { version: 1 }, me: null, now: fixedClock().now, newId: fixedIds(), warn: () => {} };
}

/** Global stages = defaults; Boards web and api (api has its own stages). */
async function setup() {
  const t = await tempRoot();
  await createRepositories(t.root).rootConfig.put({ version: 1, stages: [...DEFAULT_STAGES] });
  await makeBoard(t.path, { id: 'web', keyPrefix: 'WEB' });
  await makeBoard(t.path, {
    id: 'api',
    keyPrefix: 'API',
    stages: [
      { key: 'todo', name: 'Todo', category: 'todo' },
      { key: 'done', name: 'Done', category: 'done' },
    ],
  });
  return { t, services: createServices(contextFor(t)), repos: createRepositories(t.root) };
}

const readText = (t: TempRoot, path: string) => readFile(join(t.path, path), 'utf8');

describe('stages.add', () => {
  it('copies the inherited list to the Board, then inserts; the global config is unchanged', async () => {
    const { t, services, repos } = await setup();
    const before = await readText(t, 'rowbly.config.json');
    const list = await services.stages.add(
      { level: 'board', boardId: 'web' },
      { key: 'qa', name: 'QA', category: 'in_progress' },
      { after: 'in-progress' },
    );
    expect(keys(list)).toEqual(['backlog', 'todo', 'in-progress', 'qa', 'done']);
    expect(keys((await repos.boards.get('web')).stages ?? [])).toEqual(keys(list));
    expect(await readText(t, 'rowbly.config.json')).toBe(before);
    expect(await services.stages.list('web')).toMatchObject({ source: 'board' });
  });

  it('defaults to the end, and supports before/first', async () => {
    const { services } = await setup();
    const target = { level: 'board' as const, boardId: 'api' };
    expect(keys(await services.stages.add(target, { key: 'qa', name: 'QA', category: 'in_progress' }))).toEqual([
      'todo',
      'done',
      'qa',
    ]);
    expect(
      keys(await services.stages.add(target, { key: 'wip', name: 'WIP', category: 'in_progress' }, { before: 'done' })),
    ).toEqual(['todo', 'wip', 'done', 'qa']);
    expect(keys(await services.stages.add(target, { key: 'ice', name: 'Ice', category: 'todo' }, 'first'))[0]).toBe(
      'ice',
    );
  });

  it('rejects duplicates, unknown anchors and invalid input', async () => {
    const { services } = await setup();
    const target = { level: 'board' as const, boardId: 'web' };
    await expect(services.stages.add(target, { key: 'todo', name: 'T', category: 'todo' })).rejects.toThrow(
      ConflictError,
    );
    await expect(
      services.stages.add(target, { key: 'qa', name: 'QA', category: 'todo' }, { after: 'nope' }),
    ).rejects.toThrow(NotFoundError);
    await expect(services.stages.add(target, { key: 'Bad Key', name: 'x', category: 'todo' })).rejects.toThrow(
      ValidationError,
    );
  });

  it('at the default level writes the defaults plus the new Stage', async () => {
    const t = await tempRoot();
    const services = createServices(contextFor(t));
    const list = await services.stages.add({ level: 'global' }, { key: 'qa', name: 'QA', category: 'in_progress' });
    expect(keys(list)).toEqual([...keys([...DEFAULT_STAGES]), 'qa']);
    expect(keys((await createRepositories(t.root).rootConfig.get()).stages ?? [])).toEqual(keys(list));
  });
});

describe('stages.update / move', () => {
  it('edits the name and Stage Category, and reorders', async () => {
    const { services } = await setup();
    const target = { level: 'global' as const };
    const edited = await services.stages.update(target, 'todo', { category: 'in_progress' });
    expect(edited.find((s) => s.key === 'todo')).toEqual({ key: 'todo', name: 'Todo', category: 'in_progress' });
    expect(keys(await services.stages.move(target, 'done', 'first'))).toEqual([
      'done',
      'backlog',
      'todo',
      'in-progress',
    ]);
    expect(keys(await services.stages.move(target, 'done', { after: 'todo' }))).toEqual([
      'backlog',
      'todo',
      'done',
      'in-progress',
    ]);
    await expect(services.stages.move(target, 'done', { before: 'done' })).rejects.toThrow(UsageError);
    await expect(services.stages.update(target, 'nope', { name: 'x' })).rejects.toThrow(NotFoundError);
  });
});

describe('stages.remove', () => {
  it('refuses while Stories use the Stage; --move-to moves them to the bottom of the target', async () => {
    const { t, services, repos } = await setup();
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', stage: 'backlog', rank: 'a0' });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-2', stage: 'backlog', rank: 'a5' });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-3', stage: 'todo', rank: 'a1' });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-4', stage: 'todo', rank: 'a0' });
    const target = { level: 'board' as const, boardId: 'web' };

    const refused = await services.stages.remove(target, 'todo', {}).catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(ConflictError);
    expect((refused as ConflictError).details).toEqual({ stage: 'todo', stories: 2, needsMoveTo: true });

    expect(await services.stages.remove(target, 'todo', { moveTo: 'backlog' })).toEqual({ storiesMoved: 2 });
    const stories = await repos.stories.allInBoard('web');
    const backlog = stories.filter((s) => s.stage === 'backlog').sort((a, b) => (a.rank < b.rank ? -1 : 1));
    // Moved Stories keep their relative order and sort after the Stories already in backlog.
    expect(backlog.map((s) => s.key)).toEqual(['WEB-1', 'WEB-2', 'WEB-4', 'WEB-3']);
    expect(keys((await repos.boards.get('web')).stages ?? [])).toEqual(['backlog', 'in-progress', 'done']);
  });

  it('a global removal checks every inheriting Board, not Boards with their own Stages', async () => {
    const { t, services, repos } = await setup();
    const target = { level: 'global' as const };
    expect(await affectedBoards(contextFor(t), target, 'stages')).toEqual(['web']);
    // api has its own `todo` with a Story in it, but it does not inherit, so it is not affected.
    await makeStory(t.path, { boardId: 'api', key: 'API-1', stage: 'todo' });
    expect(await services.stages.remove(target, 'todo', {})).toEqual({ storiesMoved: 0 });
    expect(keys((await repos.rootConfig.get()).stages ?? [])).toEqual(['backlog', 'in-progress', 'done']);
    expect(keys((await repos.boards.get('api')).stages ?? [])).toEqual(['todo', 'done']);

    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', stage: 'done' });
    await expect(services.stages.remove(target, 'done', {})).rejects.toThrow(ConflictError);
  });

  it('refuses the last Stage, an unknown Stage and a bad --move-to', async () => {
    const { services } = await setup();
    const target = { level: 'board' as const, boardId: 'api' };
    await expect(services.stages.remove(target, 'nope', {})).rejects.toThrow(NotFoundError);
    await expect(services.stages.remove(target, 'todo', { moveTo: 'todo' })).rejects.toThrow(UsageError);
    await expect(services.stages.remove(target, 'todo', { moveTo: 'nope' })).rejects.toThrow(NotFoundError);
    await services.stages.remove(target, 'todo', {});
    await expect(services.stages.remove(target, 'done', {})).rejects.toThrow(/last Stage/);
  });
});

describe('readLevel', () => {
  it('reports the list at a level and where it comes from', async () => {
    const { t } = await setup();
    const ctx = contextFor(t);
    expect(await readLevel(ctx, { level: 'board', boardId: 'web' }, 'stages')).toMatchObject({ source: 'global' });
    expect(await readLevel(ctx, { level: 'board', boardId: 'api' }, 'stages')).toMatchObject({ source: 'board' });
    expect(await readLevel(ctx, { level: 'global' }, 'stages')).toMatchObject({ source: 'global' });
    expect(await readLevel(ctx, { level: 'global' }, 'customFields')).toEqual({
      items: [],
      source: 'default',
    });
  });
});
