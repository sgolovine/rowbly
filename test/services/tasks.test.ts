import { describe, expect, it } from 'vitest';
import { NotFoundError, UsageError, ValidationError } from '../../src/core';
import { createServices, type RowblyContext } from '../../src/services';
import { createRepositories } from '../../src/storage';
import { fixedClock, fixedIds, makeBoard, makeStory, tempRoot } from '../helpers';

const web = 'web';

async function setup() {
  const t = await tempRoot();
  await makeBoard(t.path, { id: 'web', keyPrefix: 'WEB' });
  await makeStory(t.path, { boardId: web, key: 'WEB-1', assignees: [] });
  const clock = fixedClock();
  const ctx: RowblyContext = {
    root: t.root,
    local: { version: 1 },
    me: null,
    now: clock.now,
    newId: fixedIds(),
    warn: () => {},
  };
  return { t, clock, services: createServices(ctx), repos: createRepositories(t.root) };
}

describe('tasks.create', () => {
  it('numbers Tasks from nextTaskNumber, never reusing a deleted id', async () => {
    const { services, repos } = await setup();
    for (const name of ['One', 'Two', 'Three']) await services.tasks.create('web-1', { name });
    await services.tasks.remove('WEB-1.3');
    const fourth = await services.tasks.create('WEB-1', { name: 'Four' });
    expect(fourth.id).toBe('WEB-1.4');
    const story = await repos.stories.findByKey('WEB-1');
    expect(story.nextTaskNumber).toBe(5);
    expect(story.tasks.map((t) => t.id)).toEqual(['WEB-1.1', 'WEB-1.2', 'WEB-1.4']);
  });

  it('defaults to the first effective Stage and stamps the Story', async () => {
    const { services, repos, clock } = await setup();
    clock.advance(60_000);
    const task = await services.tasks.create('WEB-1', { name: 'Write tests' });
    expect(task).toEqual({
      id: 'WEB-1.1',
      name: 'Write tests',
      description: '',
      stage: 'backlog',
      comments: [],
      createdAt: '2026-10-12T17:22:07.000Z',
      updatedAt: '2026-10-12T17:22:07.000Z',
    });
    expect((await repos.stories.findByKey('WEB-1')).updatedAt).toBe('2026-10-12T17:22:07.000Z');
  });

  it('rejects an unknown Stage and an empty name', async () => {
    const { services } = await setup();
    await expect(services.tasks.create('WEB-1', { name: 'X', stage: 'nope' })).rejects.toBeInstanceOf(ValidationError);
    const err = await services.tasks.create('WEB-1', { name: '' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).details.issues).toEqual([expect.objectContaining({ path: ['name'] })]);
  });

  it('throws NotFoundError for an unknown Story', async () => {
    const { services } = await setup();
    await expect(services.tasks.create('WEB-9', { name: 'X' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('tasks mutations', () => {
  it('update and move stamp both the Task and the Story', async () => {
    const { services, repos, clock } = await setup();
    await services.tasks.create('WEB-1', { name: 'Old' });
    clock.advance(1000);
    const updated = await services.tasks.update('web-1.1', { name: 'New', description: 'Body' });
    expect(updated).toMatchObject({ name: 'New', description: 'Body', updatedAt: '2026-10-12T17:21:08.000Z' });
    clock.advance(1000);
    const moved = await services.tasks.move('WEB-1.1', 'done');
    expect(moved).toMatchObject({ stage: 'done', updatedAt: '2026-10-12T17:21:09.000Z' });
    const story = await repos.stories.findByKey('WEB-1');
    expect(story.updatedAt).toBe('2026-10-12T17:21:09.000Z');
    expect(story.tasks[0]).toEqual(moved);
  });

  it('move rejects a Stage not on the Board', async () => {
    const { services } = await setup();
    await services.tasks.create('WEB-1', { name: 'X' });
    const err = await services.tasks.move('WEB-1.1', 'unknown-stage').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).details.validStages).toEqual(['backlog', 'todo', 'in-progress', 'done']);
  });

  it('get, list and errors for unknown or malformed ids', async () => {
    const { services } = await setup();
    const task = await services.tasks.create('WEB-1', { name: 'X' });
    expect(await services.tasks.list('WEB-1')).toEqual([task]);
    expect((await services.tasks.get('web-1.1')).task).toEqual(task);
    await expect(services.tasks.get('WEB-1.7')).rejects.toBeInstanceOf(NotFoundError);
    await expect(services.tasks.remove('WEB-1.7')).rejects.toBeInstanceOf(NotFoundError);
    await expect(services.tasks.get('WEB-1')).rejects.toBeInstanceOf(UsageError);
  });
});
