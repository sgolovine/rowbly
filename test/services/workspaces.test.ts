import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '../../src/core';
import type { LocalState } from '../../src/schemas';
import { createServices, type RowblyContext } from '../../src/services';
import { workspaceOverview } from '../../src/services/workspaces';
import { createRepositories } from '../../src/storage';
import {
  FIXED_NOW,
  fixedClock,
  fixedIds,
  makeBoard,
  makeEpic,
  makeWorkspace,
  type TempRoot,
  tempRoot,
} from '../helpers';

function contextFor(t: TempRoot, local: LocalState = { version: 1 }): RowblyContext {
  return { root: t.root, local, me: null, now: fixedClock().now, newId: fixedIds(), warn: () => {} };
}

describe('workspaces service', () => {
  it('create writes workspace.config.json with an empty roster and no overrides', async () => {
    const t = await tempRoot();
    const { workspaces } = createServices(contextFor(t));
    const ws = await workspaces.create({ id: 'acme', name: 'Acme' });
    expect(ws).toEqual({
      version: 1,
      id: 'acme',
      name: 'Acme',
      description: '',
      assignees: [],
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    });
    const file = await readFile(join(t.path, 'workspaces', 'acme', 'workspace.config.json'), 'utf8');
    expect(JSON.parse(file)).toEqual(ws);
    expect(await workspaces.list()).toEqual([ws]);
    expect(await workspaces.get('acme')).toEqual(ws);
  });

  it('create refuses an existing id and an invalid one', async () => {
    const t = await tempRoot();
    const { workspaces } = createServices(contextFor(t));
    await workspaces.create({ id: 'acme', name: 'Acme' });
    await expect(workspaces.create({ id: 'acme', name: 'Again' })).rejects.toThrow(ConflictError);
    const invalid = workspaces.create({ id: 'Not A Slug', name: 'x' });
    await expect(invalid).rejects.toThrow(ValidationError);
    await expect(invalid).rejects.toMatchObject({ details: { issues: [{ path: ['id'] }] } });
    await expect(workspaces.create({ id: 'ok', name: '' })).rejects.toThrow(/name/);
  });

  it('update changes name and description and bumps updatedAt', async () => {
    const t = await tempRoot();
    await makeWorkspace(t.path, { id: 'acme', name: 'Acme' });
    const clock = fixedClock();
    clock.advance(1000);
    const { workspaces } = createServices({ ...contextFor(t), now: clock.now });
    const ws = await workspaces.update('acme', { description: 'The **main** one' });
    expect(ws).toMatchObject({ name: 'Acme', description: 'The **main** one', updatedAt: '2026-10-12T17:21:08.000Z' });
    expect((await workspaces.update('acme', { name: 'ACME' })).name).toBe('ACME');
    await expect(workspaces.update('nope', { name: 'x' })).rejects.toThrow(NotFoundError);
  });

  it('remove refuses a Workspace with Boards or Epics unless forced', async () => {
    const t = await tempRoot();
    await makeWorkspace(t.path, { id: 'acme' });
    await makeBoard(t.path, { id: 'web', workspaceId: 'acme', keyPrefix: 'WEB' });
    await makeWorkspace(t.path, { id: 'labs' });
    await makeEpic(t.path, { id: 'launch', workspaceId: 'labs' });
    const { workspaces } = createServices(contextFor(t));
    await expect(workspaces.remove('acme', { force: false })).rejects.toThrow(ConflictError);
    await expect(workspaces.remove('labs', { force: false })).rejects.toThrow(/1 Epic/);
    await workspaces.remove('acme', { force: true });
    expect((await workspaces.list()).map((ws) => ws.id)).toEqual(['labs']);
    await expect(workspaces.remove('acme', { force: true })).rejects.toThrow(NotFoundError);
  });

  it('remove clears the Local State context when it pointed at the Workspace', async () => {
    const t = await tempRoot();
    await makeWorkspace(t.path, { id: 'acme' });
    await makeWorkspace(t.path, { id: 'labs' });
    const ctx = contextFor(t, { version: 1, workspace: 'acme', board: 'web', me: 'ana' });
    const { workspaces } = createServices(ctx);
    await workspaces.remove('labs', { force: false });
    expect(ctx.local.workspace).toBe('acme');
    await workspaces.remove('acme', { force: false });
    expect(ctx.local).toEqual({ version: 1, me: 'ana' });
    expect(await createRepositories(t.root).localState.get()).toEqual({ version: 1, me: 'ana' });
  });
});

describe('workspaceOverview', () => {
  it('counts what the Workspace holds and where Stages and Custom Fields are defined', async () => {
    const t = await tempRoot();
    const stages = [{ key: 'open', name: 'Open', category: 'todo' as const }];
    await makeWorkspace(t.path, { id: 'acme', stages, assignees: [{ handle: 'sam', name: 'Sam' }] });
    await makeBoard(t.path, { id: 'web', workspaceId: 'acme', keyPrefix: 'WEB', stages });
    await makeBoard(t.path, { id: 'api', workspaceId: 'acme', keyPrefix: 'API' });
    await makeEpic(t.path, { id: 'launch', workspaceId: 'acme' });
    expect(await workspaceOverview(contextFor(t), 'acme')).toMatchObject({
      boards: 2,
      epics: 1,
      assignees: 1,
      overrides: {
        stages: { global: false, workspace: true, boards: ['web'] },
        customFields: { global: false, workspace: false, boards: [] },
      },
    });
  });
});
