// RES-08, ARCH-38 (the `extra.ts` resurrection probe): a Plugin file write can never recreate the
// folder of a Story or Board that the same operation deletes. Writes to a deleted scope are rejected
// before anything is saved, reads of it return nothing, and deleting the Story or Board still removes the
// files of every Plugin, including ones that are off.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../src/core';
import { definePlugin } from '../../src/plugin-api';
import { CoreChangeSet } from '../../src/services/plugins/changeSet';
import type { ExecutionScope } from '../../src/services/plugins/executionScope';
import { createRepositories, pathExists } from '../../src/storage';
import { makeBoard, makeStory, type TempRoot } from '../helpers';
import { snapshotTree } from '../storage/engineHelpers';
import { pluginRoot, withPlugins } from './helpers';

/** A writer lease for tests that drive a Change Set directly, as a body stage would. */
const lease = (plugin: string): ExecutionScope => ({
  operationId: 'test',
  operation: 'test.op',
  plugin,
  stage: 'body',
  ended: false,
});

function changeSet(t: TempRoot): CoreChangeSet {
  return new CoreChangeSet(t.root, createRepositories(t.root));
}

async function pluginFile(t: TempRoot, folder: string, plugin: string, name: string, text: string): Promise<void> {
  await mkdir(join(t.path, folder, 'plugins', plugin), { recursive: true });
  await writeFile(join(t.path, folder, 'plugins', plugin, name), text);
}

const WEB_1 = 'boards/web/stories/WEB-1';

describe('a Story deleted in the plan', () => {
  it('rejects a file write queued after the deletion; nothing is saved (extra.ts)', async () => {
    const resurrect = definePlugin({
      id: 'resurrect',
      name: 'Resurrect',
      description: '',
      hooks: {
        'stories.remove': {
          async transform({ changes }) {
            await changes.writeFile({ story: 'WEB-1' }, 'left.txt', 'left');
          },
        },
      },
    });
    const t = await pluginRoot({ resurrect: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [resurrect]);
    const before = await snapshotTree(t.path);

    const err = await services.stories.remove('WEB-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('cannot write left.txt: its Story WEB-1 is being deleted');
    expect(await snapshotTree(t.path)).toEqual(before);
  });

  it('rejects a file write queued before the deletion, at the save; nothing is saved', async () => {
    const t = await pluginRoot();
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const before = await snapshotTree(t.path);
    const changes = changeSet(t);
    await changes.forPlugin('notes', lease('notes')).writeFile({ story: 'WEB-1' }, 'n.txt', 'N');
    await changes.deleteStory('WEB-1');

    await expect(changes.save()).rejects.toThrow(ConflictError);
    expect(await snapshotTree(t.path)).toEqual(before);
  });

  it('reads as absent, and a queued file deletion in it is dropped: the cascade removes it', async () => {
    const t = await pluginRoot();
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    await pluginFile(t, WEB_1, 'notes', 'n.txt', 'N');
    const changes = changeSet(t);
    await changes.deleteStory('WEB-1');
    const writer = changes.forPlugin('notes', lease('notes'));

    expect(await writer.readFile({ story: 'WEB-1' }, 'n.txt')).toBeNull();
    await writer.deleteFile({ story: 'WEB-1' }, 'n.txt');
    expect(changes.changes.filter((c) => c.type === 'file')).toEqual([]);
    await changes.save();
    expect(await pathExists(join(t.path, WEB_1))).toBe(false);
  });

  it('cannot be put again in the same plan', async () => {
    const t = await pluginRoot();
    const story = await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const changes = changeSet(t);
    await changes.deleteStory('WEB-1');
    await expect(changes.putStory({ ...story, name: 'Back' })).rejects.toThrow(ConflictError);
    await expect(changes.updateStory('WEB-1', (s) => s)).rejects.toThrow('not found');
  });

  it('removes the files of every Plugin with its folder, including Plugins that are off', async () => {
    const t = await pluginRoot({ notes: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    await pluginFile(t, WEB_1, 'notes', 'n.txt', 'N');
    await pluginFile(t, WEB_1, 'retired', 'old.txt', 'kept until the Story goes');
    const { services } = await withPlugins(t);

    await services.stories.remove('WEB-1');
    expect(await pathExists(join(t.path, WEB_1))).toBe(false);
  });
});

describe('a Board deleted in the plan', () => {
  const boardWriter = definePlugin({
    id: 'boardnote',
    name: 'Board note',
    description: '',
    hooks: {
      'boards.remove': {
        async transform({ changes }) {
          await changes.writeFile({ board: 'web' }, 'late.txt', 'late');
        },
      },
    },
  });

  it('rejects a Board file write after the deletion; the Board stays as it was', async () => {
    const t = await pluginRoot({ boardnote: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [boardWriter]);
    const before = await snapshotTree(t.path);

    await expect(services.boards.remove('web', { force: true })).rejects.toThrow(
      'cannot write late.txt: its Board web is being deleted',
    );
    expect(await snapshotTree(t.path)).toEqual(before);
  });

  it('rejects a file of one of its Stories, written before or after the deletion', async () => {
    const t = await pluginRoot();
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const before = await snapshotTree(t.path);

    const first = changeSet(t);
    await first.forPlugin('notes', lease('notes')).writeFile({ story: 'WEB-1' }, 'n.txt', 'N');
    await first.forPlugin('notes', lease('notes')).writeFile({ board: 'web' }, 'b.txt', 'B');
    await first.deleteBoard('web');
    await expect(first.save()).rejects.toThrow(ConflictError);
    expect(await snapshotTree(t.path)).toEqual(before);

    const second = changeSet(t);
    await second.deleteBoard('web');
    await expect(second.forPlugin('notes', lease('notes')).writeFile({ story: 'WEB-1' }, 'n.txt', 'N')).rejects.toThrow(
      'its Story WEB-1 is being deleted',
    );
    await expect(second.forPlugin('notes', lease('notes')).writeFile({ board: 'web' }, 'b.txt', 'B')).rejects.toThrow(
      'its Board web is being deleted',
    );
    expect(await second.forPlugin('notes', lease('notes')).readFile({ board: 'web' }, 'b.txt')).toBeNull();
  });

  it('rejects a new Story put beneath it; nothing is saved', async () => {
    const t = await pluginRoot();
    const story = await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const before = await snapshotTree(t.path);
    const changes = changeSet(t);
    await changes.deleteBoard('web');
    await changes.putStory({ ...story, key: 'WEB-2', name: 'Orphan' }).catch(() => undefined);
    await expect(changes.save()).rejects.toThrow(ConflictError);
    expect(await snapshotTree(t.path)).toEqual(before);
  });

  it('removes every Plugin file under it, including those of Plugins that are off', async () => {
    const t = await pluginRoot({ notes: true });
    await makeBoard(t.path, { id: 'api', name: 'API', keyPrefix: 'API' });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    await pluginFile(t, 'boards/web', 'retired', 'board.txt', 'B');
    await pluginFile(t, WEB_1, 'retired', 'story.txt', 'S');
    await pluginFile(t, 'boards/api', 'retired', 'other.txt', 'O');
    const { services } = await withPlugins(t);

    await services.boards.remove('web', { force: true });
    expect(await pathExists(join(t.path, 'boards/web'))).toBe(false);
    expect(await pathExists(join(t.path, 'boards/api/plugins/retired/other.txt'))).toBe(true);
  });
});
