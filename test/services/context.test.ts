import { describe, expect, it } from 'vitest';
import { NotFoundError, UsageError } from '../../src/core';
import type { LocalState } from '../../src/schemas';
import { createServices, type RowblyContext } from '../../src/services';
import { createRepositories } from '../../src/storage';
import { fixedClock, fixedIds, makeBoard, makeWorkspace, type TempRoot, tempRoot } from '../helpers';

function contextFor(t: TempRoot, local: LocalState = { version: 1 }): RowblyContext {
  return { root: t.root, local, me: null, now: fixedClock().now, newId: fixedIds(), warn: () => {} };
}

/** Two Workspaces: acme (web, api) and labs (ml). */
async function twoWorkspaces() {
  const t = await tempRoot();
  await makeWorkspace(t.path, { id: 'acme', assignees: [{ handle: 'ana', name: 'Ana' }] });
  await makeWorkspace(t.path, { id: 'labs' });
  await makeBoard(t.path, { id: 'web', workspaceId: 'acme', keyPrefix: 'WEB' });
  await makeBoard(t.path, { id: 'api', workspaceId: 'acme', keyPrefix: 'API' });
  await makeBoard(t.path, { id: 'ml', workspaceId: 'labs', keyPrefix: 'ML' });
  return t;
}

describe('context.resolveWorkspace', () => {
  it('with a single Workspace, no flags are needed', async () => {
    const t = await tempRoot();
    await makeWorkspace(t.path, { id: 'acme' });
    expect(await createServices(contextFor(t)).context.resolveWorkspace()).toBe('acme');
  });

  it('with two Workspaces and no context, the result is UsageError', async () => {
    const t = await twoWorkspaces();
    await expect(createServices(contextFor(t)).context.resolveWorkspace()).rejects.toThrow(UsageError);
  });

  it('with no Workspaces, the result is UsageError', async () => {
    const t = await tempRoot();
    await expect(createServices(contextFor(t)).context.resolveWorkspace()).rejects.toThrow(UsageError);
  });

  it('the flag wins over Local State; Local State wins over the only-Workspace rule', async () => {
    const t = await twoWorkspaces();
    const { context } = createServices(contextFor(t, { version: 1, workspace: 'labs' }));
    expect(await context.resolveWorkspace()).toBe('labs');
    expect(await context.resolveWorkspace('acme')).toBe('acme');
    await expect(context.resolveWorkspace('nope')).rejects.toThrow(NotFoundError);
  });

  it('skips a stale Local State Workspace', async () => {
    const t = await tempRoot();
    await makeWorkspace(t.path, { id: 'acme' });
    const { context } = createServices(contextFor(t, { version: 1, workspace: 'gone' }));
    expect(await context.resolveWorkspace()).toBe('acme');
  });
});

describe('context.resolveBoard', () => {
  it('with a single Workspace and Board, no flags are needed', async () => {
    const t = await tempRoot();
    await makeWorkspace(t.path, { id: 'acme' });
    await makeBoard(t.path, { id: 'web', workspaceId: 'acme', keyPrefix: 'WEB' });
    expect(await createServices(contextFor(t)).context.resolveBoard()).toEqual({
      workspaceId: 'acme',
      boardId: 'web',
    });
  });

  it('accepts ws/board and a bare board in the resolved Workspace', async () => {
    const t = await twoWorkspaces();
    const { context } = createServices(contextFor(t, { version: 1, workspace: 'acme' }));
    expect(await context.resolveBoard('labs/ml')).toEqual({ workspaceId: 'labs', boardId: 'ml' });
    expect(await context.resolveBoard('api')).toEqual({ workspaceId: 'acme', boardId: 'api' });
    await expect(context.resolveBoard('ml')).rejects.toThrow(NotFoundError);
  });

  it('uses the Local State Board when its Workspace matches', async () => {
    const t = await twoWorkspaces();
    const { context } = createServices(contextFor(t, { version: 1, workspace: 'acme', board: 'api' }));
    expect(await context.resolveBoard()).toEqual({ workspaceId: 'acme', boardId: 'api' });
  });

  it('ignores a Local State Board from another Workspace', async () => {
    const t = await twoWorkspaces();
    // `ml` is the only Board in labs, so it is chosen instead of the stored `web`.
    const { context } = createServices(contextFor(t, { version: 1, workspace: 'labs', board: 'web' }));
    expect(await context.resolveBoard()).toEqual({ workspaceId: 'labs', boardId: 'ml' });
  });

  it('with several Boards and no context, the result is UsageError', async () => {
    const t = await twoWorkspaces();
    const { context } = createServices(contextFor(t, { version: 1, workspace: 'acme' }));
    await expect(context.resolveBoard()).rejects.toThrow(UsageError);
  });
});

describe('context.use / clearUse / setMe', () => {
  it('stores the Workspace and Board, validating both', async () => {
    const t = await twoWorkspaces();
    const ctx = contextFor(t);
    const { context } = createServices(ctx);
    expect(await context.use('acme', 'web')).toEqual({ version: 1, workspace: 'acme', board: 'web' });
    expect(ctx.local).toEqual({ version: 1, workspace: 'acme', board: 'web' });
    expect(await context.resolveBoard()).toEqual({ workspaceId: 'acme', boardId: 'web' });
    await expect(context.use('nope')).rejects.toThrow(NotFoundError);
    await expect(context.use('labs', 'web')).rejects.toThrow(NotFoundError);
  });

  it('use without a board clears the stored board', async () => {
    const t = await twoWorkspaces();
    const { context } = createServices(contextFor(t));
    await context.use('acme', 'web');
    expect(await context.use('labs')).toEqual({ version: 1, workspace: 'labs' });
    expect(await createRepositories(t.root).localState.get()).toEqual({ version: 1, workspace: 'labs' });
  });

  it('clearUse keeps Me', async () => {
    const t = await twoWorkspaces();
    const { context } = createServices(contextFor(t));
    await context.use('acme', 'web');
    await context.setMe('ana');
    await context.clearUse();
    expect(await createRepositories(t.root).localState.get()).toEqual({ version: 1, me: 'ana' });
  });

  it('setMe validates the handle against the Workspace roster', async () => {
    const t = await twoWorkspaces();
    const ctx = contextFor(t, { version: 1, workspace: 'acme' });
    const { context } = createServices(ctx);
    expect(await context.setMe('ana')).toEqual({ version: 1, workspace: 'acme', me: 'ana' });
    expect(ctx.me).toBe('ana');
    await expect(context.setMe('bob')).rejects.toThrow(NotFoundError);
    expect(await context.setMe(null)).toEqual({ version: 1, workspace: 'acme' });
    expect(ctx.me).toBeNull();
  });
});

describe('config.effective', () => {
  it('returns the effective lists with their source levels', async () => {
    const t = await twoWorkspaces();
    const effective = await createServices(contextFor(t)).config.effective({ workspaceId: 'acme', boardId: 'web' });
    expect(effective).toMatchObject({ stagesSource: 'default', customFieldsSource: 'default', customFields: [] });
    expect(effective.stages.map((s) => s.key)).toEqual(['backlog', 'todo', 'in-progress', 'done']);
    await expect(
      createServices(contextFor(t)).config.effective({ workspaceId: 'acme', boardId: 'nope' }),
    ).rejects.toThrow(NotFoundError);
  });
});
