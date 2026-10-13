import { describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '../../src/core';
import { createServices, type RowblyContext } from '../../src/services';
import { createRepositories } from '../../src/storage';
import { fixedClock, fixedIds, makeBoard, makeEpic, makeStory, tempRoot } from '../helpers';

/** Two Boards whose done Stages have different keys and names. */
async function setup() {
  const tmp = await tempRoot();
  const clock = fixedClock();
  const warnings: string[] = [];
  const ctx: RowblyContext = {
    root: tmp.root,
    local: { version: 1 },
    me: null,
    now: clock.now,
    newId: fixedIds(),
    warn: (message) => warnings.push(message),
  };
  await makeBoard(tmp.path, {
    id: 'web',
    keyPrefix: 'WEB',
    stages: [
      { key: 'open', name: 'Open', category: 'todo' },
      { key: 'shipped', name: 'Shipped', category: 'done' },
    ],
  });
  // `api` inherits the built-in default stages, whose done stage is `done`.
  await makeBoard(tmp.path, { id: 'api', keyPrefix: 'API' });
  return { tmp, clock, ctx, warnings, services: createServices(ctx), repos: createRepositories(tmp.root) };
}

async function linkThreeStories(root: string) {
  await makeEpic(root, { id: 'launch', name: 'Launch' });
  await makeStory(root, { key: 'WEB-1', boardId: 'web', stage: 'shipped', epicId: 'launch' });
  await makeStory(root, { key: 'WEB-2', boardId: 'web', stage: 'open', epicId: 'launch' });
  await makeStory(root, { key: 'API-1', boardId: 'api', stage: 'done', epicId: 'launch' });
  // Not in the Epic.
  await makeStory(root, { key: 'API-2', boardId: 'api', stage: 'done' });
}

describe('epics service', () => {
  it('judges progress by each story’s own board stages', async () => {
    const { tmp, services } = await setup();
    await linkThreeStories(tmp.path);
    const view = await services.epics.get('launch');
    expect(view.progress).toEqual({ done: 2, total: 3 });
    expect(view.stories.map((s) => s.key).sort()).toEqual(['API-1', 'WEB-1', 'WEB-2']);
  });

  it('counts a story in an unknown stage toward total but not done', async () => {
    const { tmp, services } = await setup();
    await makeEpic(tmp.path, { id: 'launch' });
    await makeStory(tmp.path, { key: 'WEB-1', boardId: 'web', stage: 'gone', epicId: 'launch' });
    // `done` exists on `api` but not on `web`.
    await makeStory(tmp.path, { key: 'WEB-2', boardId: 'web', stage: 'done', epicId: 'launch' });
    expect((await services.epics.get('launch')).progress).toEqual({ done: 0, total: 2 });
  });

  it('lists open epics by default, closed ones with closed: true, and both with "all"', async () => {
    const { tmp, services } = await setup();
    await makeEpic(tmp.path, { id: 'alpha' });
    await makeEpic(tmp.path, { id: 'beta', closed: true });
    const ids = async (closed?: boolean | 'all') =>
      (await services.epics.list(closed === undefined ? undefined : { closed })).map((e) => e.id);
    expect(await ids()).toEqual(['alpha']);
    expect(await ids(false)).toEqual(['alpha']);
    expect(await ids(true)).toEqual(['beta']);
    expect(await ids('all')).toEqual(['alpha', 'beta']);
  });

  it('creates an epic with timestamps from the clock', async () => {
    const { services, repos } = await setup();
    const epic = await services.epics.create({ id: 'launch', name: 'Launch' });
    expect(epic).toEqual({
      version: 1,
      id: 'launch',
      name: 'Launch',
      description: '',
      closed: false,
      createdAt: '2026-10-12T17:21:07.000Z',
      updatedAt: '2026-10-12T17:21:07.000Z',
    });
    expect(await repos.epics.get('launch')).toEqual(epic);
  });

  it('rejects a duplicate id, an invalid id and an empty name', async () => {
    const { tmp, services } = await setup();
    await makeEpic(tmp.path, { id: 'launch' });
    await expect(services.epics.create({ id: 'launch', name: 'x' })).rejects.toBeInstanceOf(ConflictError);
    await expect(services.epics.create({ id: 'Not A Slug', name: 'x' })).rejects.toBeInstanceOf(ValidationError);
    await expect(services.epics.create({ id: 'other', name: '' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('edits name and description and bumps updatedAt', async () => {
    const { tmp, clock, services } = await setup();
    await makeEpic(tmp.path, { id: 'launch', name: 'Launch', description: 'old' });
    clock.advance(1000);
    const epic = await services.epics.update('launch', { description: 'new' });
    expect(epic).toMatchObject({ name: 'Launch', description: 'new', updatedAt: '2026-10-12T17:21:08.000Z' });
  });

  it('closes an epic with open stories and reopens it', async () => {
    const { tmp, services } = await setup();
    await linkThreeStories(tmp.path);
    expect((await services.epics.setClosed('launch', true)).closed).toBe(true);
    expect((await services.epics.get('launch')).closed).toBe(true);
    expect((await services.epics.setClosed('launch', false)).closed).toBe(false);
  });

  it('throws NotFoundError for an unknown epic', async () => {
    const { services } = await setup();
    await expect(services.epics.get('nope')).rejects.toBeInstanceOf(NotFoundError);
    await expect(services.epics.update('nope', { name: 'x' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(services.epics.remove('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('deletes an epic, unlinks its stories and warns with the count', async () => {
    const { tmp, clock, services, repos, warnings } = await setup();
    await linkThreeStories(tmp.path);
    clock.advance(1000);
    expect(await services.epics.remove('launch')).toEqual({ storiesUnlinked: 3 });
    expect(warnings).toEqual(['unlinked 3 Stories from Epic "launch"']);
    for (const key of ['WEB-1', 'WEB-2', 'API-1']) {
      expect(await repos.stories.findByKey(key)).toMatchObject({ epicId: null, updatedAt: '2026-10-12T17:21:08.000Z' });
    }
    // An unrelated story is untouched.
    expect((await repos.stories.findByKey('API-2')).updatedAt).toBe('2026-10-12T17:21:07.000Z');
    await expect(repos.epics.get('launch')).rejects.toBeInstanceOf(NotFoundError);
  });
});
