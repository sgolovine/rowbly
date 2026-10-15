// PERF-03, PERF-04 and the identity checks of the final plan (ADR-0019 §6, §7): indexed lookups keep
// the old answers and order, a first update reads its stored record once, and a plan whose stored
// sources changed on disk is rejected before anything is written.
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ConflictError, PluginError, ValidationError } from '../../src/core';
import { CoreChangeSet } from '../../src/services/plugins/changeSet';
import type { ExecutionScope } from '../../src/services/plugins/executionScope';
import { createRepositories, type Repositories } from '../../src/storage';
import { makeBoard, makeStory, type TempRoot, tempRoot } from '../helpers';
import { snapshotTree } from '../storage/engineHelpers';
import { pluginRoot } from './helpers';

const lease = (plugin: string): ExecutionScope => ({
  operationId: 'test',
  operation: 'test.op',
  plugin,
  stage: 'body',
  ended: false,
});

function plan(t: TempRoot): { changes: CoreChangeSet; repos: Repositories } {
  const repos = createRepositories(t.root);
  return { changes: new CoreChangeSet(t.root, repos), repos };
}

describe('the first update reads its stored record once (PERF-04)', () => {
  it('for a Story; later updates read nothing and keep the first `before`', async () => {
    const t = await pluginRoot();
    const stored = await makeStory(t.path, { boardId: 'web', key: 'WEB-1', plugins: { other: { keep: true } } });
    const { changes, repos } = plan(t);
    const reads = vi.spyOn(repos.stories, 'findByKey');

    await changes.updateStory('WEB-1', (s) => ({ ...s, name: 'One' }));
    expect(reads).toHaveBeenCalledTimes(1);
    await changes.updateStory('web-1', (s) => ({ ...s, name: 'Two' }));
    expect(reads).toHaveBeenCalledTimes(1);
    expect(changes.changes).toHaveLength(1);
    expect(changes.story('WEB-1')?.before).toEqual(stored);
    expect(changes.story('WEB-1')?.after).toMatchObject({ name: 'Two', plugins: { other: { keep: true } } });
  });

  it('for a Board', async () => {
    const t = await pluginRoot();
    const { changes, repos } = plan(t);
    const reads = vi.spyOn(repos.boards, 'get');
    await changes.updateBoard('web', (b) => ({ ...b, name: 'One' }));
    await changes.updateBoard('web', (b) => ({ ...b, name: 'Two' }));
    expect(reads).toHaveBeenCalledTimes(1);
    expect(changes.board('web')?.before?.name).toBe('Website');
    expect(changes.board('web')?.after?.name).toBe('Two');
  });

  it('an invalid update changes nothing', async () => {
    const t = await pluginRoot();
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { changes } = plan(t);
    await expect(changes.updateStory('WEB-1', (s) => ({ ...s, name: '' }))).rejects.toThrow(ValidationError);
    expect(changes.changes).toEqual([]);
  });
});

describe('indexed lookups keep their answers and order (PERF-03)', () => {
  it('finds renumbered Stories by old and new key, deleted ones by their key, in change order', async () => {
    const t = await pluginRoot();
    const one = await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-2' });
    const { changes } = plan(t);
    changes.recordStory(one, { ...one, key: 'WEB-5' });
    await changes.deleteStory('web-2');
    await changes.putStory({ ...one, key: 'WEB-6', name: 'New' });

    expect(changes.story('web-1')?.after?.key).toBe('WEB-5');
    expect(changes.story('WEB-5')?.before?.key).toBe('WEB-1');
    expect(changes.story('WEB-2')?.after).toBeNull();
    expect(changes.story('WEB-6')?.before).toBeNull();
    const view = changes.view();
    expect(view.story('web-1')?.after?.key).toBe('WEB-5');
    expect(view.story('WEB-2')?.after).toBeNull();
    expect(view.changes.map((c) => (c.type === 'story' ? (c.after ?? c.before)?.key : c.type))).toEqual([
      'WEB-5',
      'WEB-2',
      'WEB-6',
    ]);
  });

  it('a Board deletion lists its Stories, then the Board, and takes over their pending changes', async () => {
    const t = await pluginRoot();
    await makeBoard(t.path, { id: 'api', name: 'API', keyPrefix: 'API' });
    const one = await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-2' });
    const { changes } = plan(t);
    await changes.updateStory('WEB-2', (s) => ({ ...s, name: 'Edited' }));
    await changes.updateBoard('web', (b) => ({ ...b, name: 'Renamed' }));
    await changes.putStory({ ...one, key: 'WEB-3', name: 'New' });
    await changes.deleteBoard('web');

    expect(
      changes.changes.map((c) => [c.type, c.type === 'board' ? c.after?.id : (c as { after: unknown }).after]),
    ).toEqual([
      ['story', null],
      ['board', undefined],
      ['story', null],
      ['story', null],
    ]);
    expect(changes.board('web')?.before?.name).toBe('Website');
    expect(changes.story('WEB-1')?.before?.key).toBe('WEB-1');
    await changes.save();
    expect(Object.keys(await snapshotTree(join(t.path, 'boards')))).toEqual(['api', 'api/board.config.json']);
  });
});

describe('source and destination identities', () => {
  it('a Story deleted on disk after it was read fails the save; nothing is written', async () => {
    const t = await pluginRoot();
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-2' });
    const { changes } = plan(t);
    await changes.updateStory('WEB-1', (s) => ({ ...s, name: 'One' }));
    await changes.updateStory('WEB-2', (s) => ({ ...s, name: 'Two' }));
    await rm(join(t.path, 'boards/web/stories/WEB-2'), { recursive: true });
    const before = await snapshotTree(t.path);
    await expect(changes.save()).rejects.toThrow(/no longer stored in boards\/web\/stories\/WEB-2/);
    expect(await snapshotTree(t.path)).toEqual(before);
  });

  it('a new Story whose folder was taken meanwhile fails the save', async () => {
    const t = await pluginRoot();
    const one = await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { changes } = plan(t);
    await changes.putStory({ ...one, key: 'WEB-2', name: 'Mine' });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-2', name: 'Theirs' });
    await expect(changes.save()).rejects.toThrow(ConflictError);
  });

  it('a core change of a Story Key outside doctor fails the save', async () => {
    const t = await pluginRoot();
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { changes } = plan(t);
    await changes.updateStory('WEB-1', (s) => ({ ...s, name: 'One' }));
    const change = changes.story('WEB-1');
    if (change?.after) change.after.key = 'WEB-9';
    await expect(changes.save()).rejects.toThrow(ValidationError);
  });

  it('a Plugin cannot turn a Plugin on or off through the root config', async () => {
    const t = await pluginRoot({ notes: true });
    const { changes } = plan(t);
    const writer = changes.forPlugin('notes', lease('notes'));
    await expect(
      writer.updateRootConfig((c) => ({ ...c, plugins: { ...c.plugins, notes: { enabled: false } } })),
    ).rejects.toThrow(PluginError);
    await writer.updateRootConfig((c) => ({
      ...c,
      plugins: { ...c.plugins, notes: { ...c.plugins?.notes, marker: '>' } },
    }));
    expect(changes.changes).toHaveLength(1);
  });

  it('a Plugin file reached through a symbolic link is rejected before anything is written (RES-21)', async () => {
    const t = await pluginRoot();
    const outside = await tempRoot();
    await mkdir(join(t.path, 'plugins'), { recursive: true });
    await symlink(outside.path, join(t.path, 'plugins/notes'));
    await writeFile(join(outside.path, 'secret.txt'), 'secret');
    const { changes } = plan(t);
    const writer = changes.forPlugin('notes', lease('notes'));
    await expect(writer.readFile('dataRoot', 'secret.txt')).rejects.toThrow(/symbolic link/);
    await expect(writer.writeFile('dataRoot', 'secret.txt', 'owned')).rejects.toThrow(/symbolic link/);
    expect(await readFile(join(outside.path, 'secret.txt'), 'utf8')).toBe('secret');
  });
});
