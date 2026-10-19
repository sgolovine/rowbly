import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError, UsageError, ValidationError } from '../../src/core';
import { DEFAULT_STAGES } from '../../src/schemas';
import { createServices, type RowblyContext } from '../../src/services';
import { affectedBoards, readLevel } from '../../src/services/_configTarget';
import { createRepositories } from '../../src/storage';
import { fixedClock, fixedIds, makeBoard, makeStory, type TempRoot, tempRoot } from '../helpers';

const keys = (stages: readonly { key: string }[]) => stages.map((s) => s.key);

function contextFor(t: TempRoot): RowblyContext {
  return { root: t.root, local: { version: 1 }, me: null, now: fixedClock().now, newId: fixedIds(), warn: () => {} };
}

/** Global stages = defaults; Boards web and api (api has its own stages). */
async function setup() {
  const t = await tempRoot();
  await createRepositories(t.root).rootConfig.put({ version: 1, stages: [...DEFAULT_STAGES] });
  await makeBoard(t.path, { id: 'web', keyPrefix: 'WEB' });
  await makeBoard(t.path, { id: 'api', keyPrefix: 'API', stages: [{ key: 'todo', name: 'Todo' }] });
  return { t, services: createServices(contextFor(t)), repos: createRepositories(t.root) };
}

const readText = (t: TempRoot, path: string) => readFile(join(t.path, path), 'utf8');

describe('stages.add', () => {
  it('copies the inherited list to the Board, then inserts; the global config is unchanged', async () => {
    const { t, services, repos } = await setup();
    const before = await readText(t, 'rowbly.config.json');
    const list = await services.stages.add(
      { level: 'board', boardId: 'web' },
      { key: 'qa', name: 'QA' },
      { after: 'in-progress' },
    );
    expect(keys(list)).toEqual(['backlog', 'todo', 'in-progress', 'qa', 'done']);
    expect(list.find((s) => s.key === 'qa')).toEqual({ key: 'qa', name: 'QA', category: 'board' });
    // Backlog and Done are never stored.
    expect(keys((await repos.boards.get('web')).stages ?? [])).toEqual(['todo', 'in-progress', 'qa']);
    expect(await readText(t, 'rowbly.config.json')).toBe(before);
    expect(await services.stages.list('web')).toMatchObject({ source: 'board' });
  });

  it('defaults to just before Done, and supports before/after the fixed Stages and first', async () => {
    const { services } = await setup();
    const target = { level: 'board' as const, boardId: 'api' };
    expect(keys(await services.stages.add(target, { key: 'qa', name: 'QA' }))).toEqual([
      'backlog',
      'todo',
      'qa',
      'done',
    ]);
    expect(keys(await services.stages.add(target, { key: 'wip', name: 'WIP' }, { before: 'done' }))).toEqual([
      'backlog',
      'todo',
      'qa',
      'wip',
      'done',
    ]);
    expect(keys(await services.stages.add(target, { key: 'ice', name: 'Ice' }, { after: 'backlog' }))[1]).toBe('ice');
    expect(keys(await services.stages.add(target, { key: 'new', name: 'New' }, 'first'))[1]).toBe('new');
  });

  it('rejects duplicates, the fixed keys, positions outside Backlog and Done, unknown anchors and invalid input', async () => {
    const { services } = await setup();
    const target = { level: 'board' as const, boardId: 'web' };
    await expect(services.stages.add(target, { key: 'todo', name: 'T' })).rejects.toThrow(ConflictError);
    await expect(services.stages.add(target, { key: 'backlog', name: 'B' })).rejects.toThrow(ValidationError);
    await expect(services.stages.add(target, { key: 'done', name: 'D' })).rejects.toThrow(ValidationError);
    await expect(services.stages.add(target, { key: 'qa', name: 'QA' }, { before: 'backlog' })).rejects.toThrow(
      UsageError,
    );
    await expect(services.stages.add(target, { key: 'qa', name: 'QA' }, { after: 'done' })).rejects.toThrow(UsageError);
    await expect(services.stages.add(target, { key: 'qa', name: 'QA' }, { after: 'nope' })).rejects.toThrow(
      NotFoundError,
    );
    await expect(services.stages.add(target, { key: 'Bad Key', name: 'x' })).rejects.toThrow(ValidationError);
  });

  it('at the default level writes the defaults plus the new Stage', async () => {
    const t = await tempRoot();
    const services = createServices(contextFor(t));
    const list = await services.stages.add({ level: 'global' }, { key: 'qa', name: 'QA' });
    expect(keys(list)).toEqual(['backlog', 'todo', 'in-progress', 'qa', 'done']);
    expect(keys((await createRepositories(t.root).rootConfig.get()).stages ?? [])).toEqual([
      'todo',
      'in-progress',
      'qa',
    ]);
  });
});

describe('stages.update / move', () => {
  it('edits the name and reorders between Backlog and Done', async () => {
    const { services } = await setup();
    const target = { level: 'global' as const };
    const edited = await services.stages.update(target, 'todo', { name: 'Next' });
    expect(edited.find((s) => s.key === 'todo')).toEqual({ key: 'todo', name: 'Next', category: 'board' });
    expect(keys(await services.stages.move(target, 'in-progress', 'first'))).toEqual([
      'backlog',
      'in-progress',
      'todo',
      'done',
    ]);
    expect(keys(await services.stages.move(target, 'in-progress', { before: 'done' }))).toEqual([
      'backlog',
      'todo',
      'in-progress',
      'done',
    ]);
    await expect(services.stages.move(target, 'todo', { before: 'todo' })).rejects.toThrow(UsageError);
    await expect(services.stages.move(target, 'todo', { before: 'backlog' })).rejects.toThrow(UsageError);
    await expect(services.stages.update(target, 'nope', { name: 'x' })).rejects.toThrow(NotFoundError);
  });

  it('refuses to edit or move Backlog and Done', async () => {
    const { services } = await setup();
    const target = { level: 'global' as const };
    await expect(services.stages.update(target, 'backlog', { name: 'Icebox' })).rejects.toThrow(/is fixed/);
    await expect(services.stages.move(target, 'done', 'first')).rejects.toThrow(/is fixed/);
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
    expect(keys((await repos.boards.get('web')).stages ?? [])).toEqual(['in-progress']);
  });

  it('a global removal checks every inheriting Board, not Boards with their own Stages', async () => {
    const { t, services, repos } = await setup();
    const target = { level: 'global' as const };
    expect(await affectedBoards(contextFor(t), target, 'stages')).toEqual(['web']);
    // api has its own `todo` with a Story in it, but it does not inherit, so it is not affected.
    await makeStory(t.path, { boardId: 'api', key: 'API-1', stage: 'todo' });
    expect(await services.stages.remove(target, 'todo', {})).toEqual({ storiesMoved: 0 });
    expect(keys((await repos.rootConfig.get()).stages ?? [])).toEqual(['in-progress']);
    expect(keys((await repos.boards.get('api')).stages ?? [])).toEqual(['todo']);

    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', stage: 'in-progress' });
    await expect(services.stages.remove(target, 'in-progress', {})).rejects.toThrow(ConflictError);
  });

  it('removes the last configured Stage, and refuses Backlog, Done, an unknown Stage and a bad --move-to', async () => {
    const { t, services, repos } = await setup();
    const target = { level: 'board' as const, boardId: 'api' };
    await expect(services.stages.remove(target, 'backlog', {})).rejects.toThrow(/is fixed/);
    await expect(services.stages.remove(target, 'done', {})).rejects.toThrow(/is fixed/);
    await expect(services.stages.remove(target, 'nope', {})).rejects.toThrow(NotFoundError);
    await expect(services.stages.remove(target, 'todo', { moveTo: 'todo' })).rejects.toThrow(UsageError);
    await expect(services.stages.remove(target, 'todo', { moveTo: 'nope' })).rejects.toThrow(NotFoundError);
    await makeStory(t.path, { boardId: 'api', key: 'API-1', stage: 'todo' });
    expect(await services.stages.remove(target, 'todo', { moveTo: 'done' })).toEqual({ storiesMoved: 1 });
    expect((await repos.boards.get('api')).stages).toEqual([]);
    expect(keys((await services.stages.list('api')).stages)).toEqual(['backlog', 'done']);
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
