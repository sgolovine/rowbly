import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '../../src/core';
import type { LocalState } from '../../src/schemas';
import { createServices, type RowblyContext } from '../../src/services';
import { storyCountsByStage } from '../../src/services/boards';
import { createRepositories } from '../../src/storage';
import { fixedClock, fixedIds, makeBoard, makeStory, makeWorkspace, type TempRoot, tempRoot } from '../helpers';

function contextFor(t: TempRoot, local: LocalState = { version: 1 }): RowblyContext {
  return { root: t.root, local, me: null, now: fixedClock().now, newId: fixedIds(), warn: () => {} };
}

async function setup() {
  const t = await tempRoot();
  await makeWorkspace(t.path, { id: 'acme' });
  await makeWorkspace(t.path, { id: 'labs' });
  return t;
}

describe('boards.create', () => {
  it('writes board.config.json with no overrides', async () => {
    const t = await setup();
    const board = await createServices(contextFor(t)).boards.create('acme', {
      id: 'web',
      name: 'Web',
      keyPrefix: 'web',
    });
    expect(board).toMatchObject({ id: 'web', workspaceId: 'acme', keyPrefix: 'WEB', description: '' });
    const file = JSON.parse(await readFile(join(t.path, 'workspaces/acme/boards/web/board.config.json'), 'utf8'));
    expect(file).not.toHaveProperty('stages');
    expect(file).not.toHaveProperty('customFields');
  });

  it('refuses a key prefix used anywhere in the Data Root', async () => {
    const t = await setup();
    const services = createServices(contextFor(t));
    await services.boards.create('acme', { id: 'web', name: 'Web', keyPrefix: 'WEB' });
    await expect(services.boards.create('labs', { id: 'site', name: 'Site', keyPrefix: 'WEB' })).rejects.toThrow(
      ConflictError,
    );
  });

  it('refuses an existing id, a bad prefix and an unknown Workspace', async () => {
    const t = await setup();
    const services = createServices(contextFor(t));
    await services.boards.create('acme', { id: 'web', name: 'Web', keyPrefix: 'WEB' });
    await expect(services.boards.create('acme', { id: 'web', name: 'W', keyPrefix: 'WEBX' })).rejects.toThrow(
      ConflictError,
    );
    await expect(services.boards.create('acme', { id: 'api', name: 'Api', keyPrefix: '1X' })).rejects.toThrow(
      ValidationError,
    );
    await expect(services.boards.create('nope', { id: 'api', name: 'Api', keyPrefix: 'API' })).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('boards.update / list / get', () => {
  it('edits the name and description', async () => {
    const t = await setup();
    await makeBoard(t.path, { id: 'web', workspaceId: 'acme', keyPrefix: 'WEB' });
    const clock = fixedClock('2026-11-01T00:00:00.000Z');
    const services = createServices({ ...contextFor(t), now: clock.now });
    const updated = await services.boards.update({ workspaceId: 'acme', boardId: 'web' }, { description: 'site' });
    expect(updated).toMatchObject({ name: 'web', description: 'site', updatedAt: '2026-11-01T00:00:00.000Z' });
    expect((await services.boards.list('acme')).map((b) => b.id)).toEqual(['web']);
    await expect(services.boards.list('nope')).rejects.toThrow(NotFoundError);
  });
});

describe('boards.remove', () => {
  const ref = { workspaceId: 'acme', boardId: 'web' };

  it('refuses a Board with Stories unless forced', async () => {
    const t = await setup();
    await makeBoard(t.path, { ...ref, id: 'web', keyPrefix: 'WEB' });
    await makeStory(t.path, { ...ref, key: 'WEB-1' });
    const services = createServices(contextFor(t));
    await expect(services.boards.remove(ref, { force: false })).rejects.toThrow(ConflictError);
    await services.boards.remove(ref, { force: true });
    await expect(stat(join(t.path, 'workspaces/acme/boards/web'))).rejects.toThrow();
  });

  it('clears local.json board when the current Board is deleted', async () => {
    const t = await setup();
    await makeBoard(t.path, { ...ref, id: 'web', keyPrefix: 'WEB' });
    const repos = createRepositories(t.root);
    await repos.localState.put({ version: 1, workspace: 'acme', board: 'web', me: 'ana' });
    const ctx = contextFor(t, await repos.localState.get());
    await createServices(ctx).boards.remove(ref, { force: false });
    expect(await repos.localState.get()).toEqual({ version: 1, workspace: 'acme', me: 'ana' });
    expect(ctx.local.board).toBeUndefined();
  });
});

describe('storyCountsByStage', () => {
  it('counts Stories per Stage key', async () => {
    const t = await setup();
    const ref = { workspaceId: 'acme', boardId: 'web' };
    await makeBoard(t.path, { ...ref, id: 'web', keyPrefix: 'WEB' });
    await makeStory(t.path, { ...ref, key: 'WEB-1', stage: 'todo' });
    await makeStory(t.path, { ...ref, key: 'WEB-2', stage: 'todo' });
    await makeStory(t.path, { ...ref, key: 'WEB-3', stage: 'done' });
    expect(await storyCountsByStage(contextFor(t), ref)).toEqual({ todo: 2, done: 1 });
  });
});
