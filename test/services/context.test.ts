import { describe, expect, it } from 'vitest';
import { NotFoundError, UsageError } from '../../src/core';
import type { LocalState } from '../../src/schemas';
import { createServices, type RowblyContext } from '../../src/services';
import { createRepositories } from '../../src/storage';
import { fixedClock, fixedIds, makeBoard, makeRootConfig, type TempRoot, tempRoot } from '../helpers';

function contextFor(t: TempRoot, local: LocalState = { version: 1 }): RowblyContext {
  return { root: t.root, local, me: null, now: fixedClock().now, newId: fixedIds(), warn: () => {} };
}

/** Two Boards (web, api) and a roster with ana. */
async function twoBoards() {
  const t = await tempRoot();
  await makeRootConfig(t.path, { assignees: [{ handle: 'ana', name: 'Ana' }] });
  await makeBoard(t.path, { id: 'web', keyPrefix: 'WEB' });
  await makeBoard(t.path, { id: 'api', keyPrefix: 'API' });
  return t;
}

describe('context.resolveBoard', () => {
  it('with a single Board, no flags are needed', async () => {
    const t = await tempRoot();
    await makeBoard(t.path, { id: 'web', keyPrefix: 'WEB' });
    expect(await createServices(contextFor(t)).context.resolveBoard()).toBe('web');
  });

  it('with no Boards, the result is UsageError', async () => {
    const t = await tempRoot();
    await expect(createServices(contextFor(t)).context.resolveBoard()).rejects.toThrow(UsageError);
  });

  it('with several Boards and no context, the result is UsageError', async () => {
    const t = await twoBoards();
    await expect(createServices(contextFor(t)).context.resolveBoard()).rejects.toThrow(UsageError);
  });

  it('the flag wins over Local State; Local State wins over the only-Board rule', async () => {
    const t = await twoBoards();
    const { context } = createServices(contextFor(t, { version: 1, board: 'api' }));
    expect(await context.resolveBoard()).toBe('api');
    expect(await context.resolveBoard('web')).toBe('web');
    await expect(context.resolveBoard('nope')).rejects.toThrow(NotFoundError);
  });

  it('skips a stale Local State Board', async () => {
    const t = await tempRoot();
    await makeBoard(t.path, { id: 'web', keyPrefix: 'WEB' });
    const { context } = createServices(contextFor(t, { version: 1, board: 'gone' }));
    expect(await context.resolveBoard()).toBe('web');
  });
});

describe('context.use / clearUse / setMe', () => {
  it('stores the Board, validating it', async () => {
    const t = await twoBoards();
    const ctx = contextFor(t);
    const { context } = createServices(ctx);
    expect(await context.use('web')).toEqual({ version: 1, board: 'web' });
    expect(ctx.local).toEqual({ version: 1, board: 'web' });
    expect(await createRepositories(t.root).localState.get()).toEqual({ version: 1, board: 'web' });
    expect(await context.resolveBoard()).toBe('web');
    await expect(context.use('nope')).rejects.toThrow(NotFoundError);
  });

  it('clearUse keeps Me', async () => {
    const t = await twoBoards();
    const { context } = createServices(contextFor(t));
    await context.use('web');
    await context.setMe('ana');
    await context.clearUse();
    expect(await createRepositories(t.root).localState.get()).toEqual({ version: 1, me: 'ana' });
  });

  it('setMe validates the handle against the roster', async () => {
    const t = await twoBoards();
    const ctx = contextFor(t);
    const { context } = createServices(ctx);
    await context.use('web');
    expect(await context.setMe('ana')).toEqual({ version: 1, board: 'web', me: 'ana' });
    expect(ctx.me).toBe('ana');
    await expect(context.setMe('bob')).rejects.toThrow(NotFoundError);
    expect(await context.setMe(null)).toEqual({ version: 1, board: 'web' });
    expect(ctx.me).toBeNull();
  });
});

describe('config.effective', () => {
  it('returns the effective lists with their source levels', async () => {
    const t = await twoBoards();
    const effective = await createServices(contextFor(t)).config.effective('web');
    expect(effective).toMatchObject({ stagesSource: 'default', customFieldsSource: 'default', customFields: [] });
    expect(effective.stages.map((s) => s.key)).toEqual(['backlog', 'todo', 'in-progress', 'done']);
    await expect(createServices(contextFor(t)).config.effective('nope')).rejects.toThrow(NotFoundError);
  });
});
