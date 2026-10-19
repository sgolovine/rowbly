import { describe, expect, it } from 'vitest';
import { NotFoundError, UsageError, ValidationError } from '../../src/core';
import { createServices, type RowblyContext } from '../../src/services';
import { createRepositories } from '../../src/storage';
import { fixedClock, fixedIds, makeBoard, makeRootConfig, makeStory, type TempRoot, tempRoot } from '../helpers';

const web = 'web';
const api = 'api';

async function setup(opts: { me?: string | null } = {}) {
  const t = await tempRoot();
  await makeRootConfig(t.path, {
    assignees: [
      { handle: 'alice', name: 'Alice' },
      { handle: 'bob', name: 'Bob' },
    ],
  });
  await makeBoard(t.path, {
    id: 'web',
    keyPrefix: 'WEB',
    customFields: [
      { key: 'estimate', name: 'Estimate', type: 'number', required: false },
      { key: 'size', name: 'Size', type: 'select', options: ['s', 'm', 'l'], required: false },
    ],
  });
  const clock = fixedClock();
  const ctx = contextFor(t, opts.me ?? null, clock.now);
  return { t, clock, ctx, services: createServices(ctx), repos: createRepositories(t.root) };
}

function contextFor(t: TempRoot, me: string | null, now = fixedClock().now): RowblyContext {
  return { root: t.root, local: { version: 1 }, me, now, newId: fixedIds(), warn: () => {} };
}

describe('stories.create', () => {
  it('creates the first Story in the first Stage, creating the stories folder', async () => {
    const { services, repos } = await setup({ me: 'alice' });
    const story = await services.stories.create(web, { name: 'First' });
    expect(story).toMatchObject({
      key: 'WEB-1',
      stage: 'backlog',
      createdBy: 'alice',
      customFields: {},
      createdAt: '2026-10-12T17:21:07.000Z',
    });
    expect(await repos.stories.findByKey('web-1')).toEqual(story);
  });

  it('allocates max+1 and reuses a deleted highest key', async () => {
    const { t, services } = await setup();
    for (const key of ['WEB-1', 'WEB-2', 'WEB-3']) await makeStory(t.path, { boardId: web, key });
    expect((await services.stories.create(web, { name: 'Four' })).key).toBe('WEB-4');
    await services.stories.remove('WEB-4');
    expect((await services.stories.create(web, { name: 'Again' })).key).toBe('WEB-4');
  });

  it('ranks new Stories at the bottom of their Stage', async () => {
    const { services } = await setup();
    const a = await services.stories.create(web, { name: 'A' });
    const b = await services.stories.create(web, { name: 'B' });
    expect(b.rank > a.rank).toBe(true);
    expect((await services.stories.list(web, {})).map((s) => s.key)).toEqual(['WEB-1', 'WEB-2']);
  });

  it('sets createdBy to null when Me is not in the roster', async () => {
    const { t } = await setup();
    const services = createServices(contextFor(t, 'stranger'));
    expect((await services.stories.create(web, { name: 'X' })).createdBy).toBeNull();
  });

  it('rejects unknown Assignees with the valid handles in details', async () => {
    const { services } = await setup();
    const err = await services.stories.create(web, { name: 'X', assignees: ['nobody'] }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.details.validHandles).toEqual(['alice', 'bob']);
  });

  it('resolves "me" in assignees and refuses it when Me is unset', async () => {
    const { t, services } = await setup();
    await expect(services.stories.create(web, { name: 'X', assignees: ['me'] })).rejects.toThrow(UsageError);
    const withMe = createServices(contextFor(t, 'bob'));
    expect((await withMe.stories.create(web, { name: 'X', assignees: ['me', 'bob'] })).assignees).toEqual(['bob']);
  });

  it('validates the Stage, labels, due date and Custom Fields', async () => {
    const { services } = await setup();
    await expect(services.stories.create(web, { name: 'X', stage: 'nope' })).rejects.toThrow(ValidationError);
    await expect(services.stories.create(web, { name: 'X', labels: ['Bad Label'] })).rejects.toThrow(ValidationError);
    await expect(services.stories.create(web, { name: 'X', dueDate: '2026-13-01' })).rejects.toThrow(ValidationError);
    await expect(services.stories.create(web, { name: 'X', customFields: { estimate: 'abc' } })).rejects.toThrow(
      ValidationError,
    );
    const story = await services.stories.create(web, {
      name: 'X',
      stage: 'todo',
      priority: 'P1',
      labels: ['ui', 'ui', 'api'],
      dueDate: '2026-11-01',
      customFields: { estimate: '3', size: 'm' },
    });
    expect(story).toMatchObject({
      stage: 'todo',
      priority: 'P1',
      labels: ['ui', 'api'],
      dueDate: '2026-11-01',
      customFields: { estimate: 3, size: 'm' },
    });
  });

  it('requires required Custom Fields', async () => {
    const { t, services } = await setup();
    await makeBoard(t.path, {
      id: 'api',
      keyPrefix: 'API',
      customFields: [{ key: 'team', name: 'Team', type: 'text', required: true }],
    });
    await expect(services.stories.create(api, { name: 'X' })).rejects.toThrow('Team is required');
    expect((await services.stories.create(api, { name: 'X', customFields: { team: 'core' } })).key).toBe('API-1');
  });
});

describe('stories.update', () => {
  it('replaces, adds and removes Assignees and Labels and refreshes updatedAt', async () => {
    const { t, services, clock } = await setup();
    await makeStory(t.path, { boardId: web, key: 'WEB-1', assignees: ['alice'], labels: ['ui'] });
    clock.advance(1000);
    let story = await services.stories.update('web-1', { addAssignees: ['bob'], addLabels: ['api'] });
    expect(story).toMatchObject({ assignees: ['alice', 'bob'], labels: ['ui', 'api'] });
    expect(story.updatedAt).toBe('2026-10-12T17:21:08.000Z');
    story = await services.stories.update('WEB-1', { removeAssignees: ['alice'], removeLabels: ['ui'] });
    expect(story).toMatchObject({ assignees: ['bob'], labels: ['api'] });
    story = await services.stories.update('WEB-1', { assignees: [], labels: ['x'] });
    expect(story).toMatchObject({ assignees: [], labels: ['x'] });
    await expect(services.stories.update('WEB-1', { assignees: ['bob'], addAssignees: ['alice'] })).rejects.toThrow(
      UsageError,
    );
    await expect(services.stories.update('WEB-1', { addAssignees: ['nobody'] })).rejects.toThrow(ValidationError);
  });

  it('clears with null and sets/unsets Custom Fields', async () => {
    const { t, services } = await setup();
    await makeStory(t.path, {
      boardId: web,
      key: 'WEB-1',
      priority: 'P2',
      dueDate: '2026-11-01',
      customFields: { estimate: 2 },
    });
    const story = await services.stories.update('WEB-1', {
      name: 'Renamed',
      description: 'Body',
      priority: null,
      dueDate: null,
      customFields: { size: 'l' },
      unsetFields: ['estimate'],
    });
    expect(story).toMatchObject({
      name: 'Renamed',
      description: 'Body',
      priority: null,
      dueDate: null,
      customFields: { size: 'l' },
    });
    await expect(services.stories.update('WEB-1', { customFields: { size: 'xl' } })).rejects.toThrow(ValidationError);
  });

  it('throws NotFoundError for an unknown Story', async () => {
    const { services } = await setup();
    await expect(services.stories.update('WEB-9', { name: 'X' })).rejects.toThrow(NotFoundError);
    await expect(services.stories.get('ZZZ-1')).rejects.toThrow(NotFoundError);
  });
});

describe('stories.move and stories.rank', () => {
  async function three() {
    const env = await setup();
    await makeStory(env.t.path, { boardId: web, key: 'WEB-1', rank: 'a0' });
    await makeStory(env.t.path, { boardId: web, key: 'WEB-2', rank: 'a1' });
    await makeStory(env.t.path, { boardId: web, key: 'WEB-3', rank: 'a2' });
    await makeStory(env.t.path, { boardId: web, key: 'WEB-4', stage: 'done', rank: 'a0' });
    return env;
  }
  const keys = async (services: ReturnType<typeof createServices>, stage = 'backlog') =>
    (await services.stories.list(web, { stages: [stage] })).map((s) => s.key);

  it('moves to the bottom of the target Stage, or the top with top: true', async () => {
    const { services } = await three();
    expect((await services.stories.move('web-2', 'done')).stage).toBe('done');
    expect(await keys(services, 'done')).toEqual(['WEB-4', 'WEB-2']);
    await services.stories.move('WEB-1', 'done', { top: true });
    expect(await keys(services, 'done')).toEqual(['WEB-1', 'WEB-4', 'WEB-2']);
    await expect(services.stories.move('WEB-3', 'nope')).rejects.toThrow(ValidationError);
  });

  it('ranks before, after, top and bottom within the Stage', async () => {
    const { services } = await three();
    await services.stories.rank('WEB-3', { before: 'WEB-1' });
    expect(await keys(services)).toEqual(['WEB-3', 'WEB-1', 'WEB-2']);
    await services.stories.rank('WEB-3', { after: 'web-1' });
    expect(await keys(services)).toEqual(['WEB-1', 'WEB-3', 'WEB-2']);
    await services.stories.rank('WEB-2', 'top');
    expect(await keys(services)).toEqual(['WEB-2', 'WEB-1', 'WEB-3']);
    await services.stories.rank('WEB-2', 'bottom');
    expect(await keys(services)).toEqual(['WEB-1', 'WEB-3', 'WEB-2']);
  });

  it('refuses to rank against a Story in another Stage or itself', async () => {
    const { services } = await three();
    await expect(services.stories.rank('WEB-1', { before: 'WEB-4' })).rejects.toThrow(UsageError);
    await expect(services.stories.rank('WEB-1', { before: 'WEB-1' })).rejects.toThrow(UsageError);
    await expect(services.stories.rank('WEB-1', { before: 'WEB-99' })).rejects.toThrow(NotFoundError);
  });
});

describe('stories.list', () => {
  async function seeded() {
    const env = await setup({ me: 'alice' });
    const { t } = env;
    await makeBoard(t.path, { id: 'api', keyPrefix: 'API' });
    await makeStory(t.path, {
      boardId: web,
      key: 'WEB-1',
      name: 'Login page',
      stage: 'todo',
      assignees: ['alice'],
      labels: ['ui'],
      priority: 'P2',
      dueDate: '2026-11-05',
    });
    await makeStory(t.path, {
      boardId: web,
      key: 'WEB-2',
      name: 'Logout',
      description: 'Clear the SESSION cookie',
      stage: 'backlog',
      priority: 'P0',
      updatedAt: '2026-10-13T00:00:00.000Z',
    });
    await makeStory(t.path, { boardId: web, key: 'WEB-3', name: 'Ship', stage: 'done', assignees: ['alice', 'bob'] });
    await makeStory(t.path, { boardId: api, key: 'API-1', name: 'Endpoint', labels: ['api'], dueDate: '2026-10-20' });
    return env;
  }
  const keys = (stories: { key: string }[]) => stories.map((s) => s.key);

  it('sorts by Stage order then Rank and applies every filter', async () => {
    const { services } = await seeded();
    expect(keys(await services.stories.list(web, {}))).toEqual(['WEB-2', 'WEB-1', 'WEB-3']);
    expect(keys(await services.stories.list(web, { stages: ['todo', 'done'] }))).toEqual(['WEB-1', 'WEB-3']);
    expect(keys(await services.stories.list(web, { category: 'done' }))).toEqual(['WEB-3']);
    expect(keys(await services.stories.list(web, { open: true, assignees: ['me'] }))).toEqual(['WEB-1']);
    expect(keys(await services.stories.list(web, { assignees: ['bob'] }))).toEqual(['WEB-3']);
    expect(keys(await services.stories.list(web, { labels: ['ui'] }))).toEqual(['WEB-1']);
    expect(keys(await services.stories.list(web, { priorities: ['P0', 'P2'] }))).toEqual(['WEB-2', 'WEB-1']);
    expect(keys(await services.stories.list(web, { search: 'session' }))).toEqual(['WEB-2']);
    expect(keys(await services.stories.list(web, { search: 'LOG' }))).toEqual(['WEB-2', 'WEB-1']);
  });

  it('sorts by priority, due, created and updated', async () => {
    const { services } = await seeded();
    expect(keys(await services.stories.list(web, { sort: 'priority' }))).toEqual(['WEB-2', 'WEB-1', 'WEB-3']);
    expect(keys(await services.stories.list(null, { sort: 'due' }))).toEqual(['API-1', 'WEB-1', 'WEB-2', 'WEB-3']);
    expect(keys(await services.stories.list(web, { sort: 'updated' }))[0]).toBe('WEB-2');
    expect(keys(await services.stories.list(web, { sort: 'created' }))).toEqual(['WEB-2', 'WEB-1', 'WEB-3']);
  });

  it('lists every Board with a null Board', async () => {
    const { services } = await seeded();
    expect(keys(await services.stories.list(null, {}))).toEqual(['API-1', 'WEB-2', 'WEB-1', 'WEB-3']);
  });

  it('refuses "me" when Me is unset', async () => {
    const { t } = await seeded();
    const services = createServices(contextFor(t, null));
    await expect(services.stories.list(web, { assignees: ['me'] })).rejects.toThrow(UsageError);
  });

  it('labelsInUse returns the distinct sorted labels of the Board', async () => {
    const { t, services } = await seeded();
    await makeStory(t.path, { boardId: web, key: 'WEB-4', labels: ['backend', 'ui'] });
    expect(await services.stories.labelsInUse(web)).toEqual(['backend', 'ui']);
  });
});
