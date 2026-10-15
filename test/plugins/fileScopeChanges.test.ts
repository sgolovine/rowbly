// RES-10 (`move-file.ts`) and RES-24 (`crosscheck.ts`): a pending Plugin file belongs to its Story or Board,
// not to a path. A Story renumbered after its file was queued takes the file with it, and a Board
// created in the plan can own files in the same operation.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/core';
import { definePlugin } from '../../src/plugin-api';
import { CoreChangeSet } from '../../src/services/plugins/changeSet';
import type { ExecutionScope } from '../../src/services/plugins/executionScope';
import { createRepositories, pathExists } from '../../src/storage';
import { makeStory, type TempRoot } from '../helpers';
import { snapshotTree } from '../storage/engineHelpers';
import { pluginRoot, readJsonFile, storyFile, withPlugins } from './helpers';

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

const stories = (t: TempRoot) => readdir(join(t.path, 'boards/web/stories'));

describe('a Story renumbered in the plan (RES-10)', () => {
  it('takes a file queued before the renumbering to its new folder, with no orphan folder (move-file.ts)', async () => {
    const t = await pluginRoot();
    const story = await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const changes = changeSet(t);
    await changes.forPlugin('fixture', lease('fixture')).writeFile({ story: 'WEB-1' }, 'note.txt', 'new');
    changes.recordStory(story, { ...story, key: 'WEB-2' });
    await changes.save();

    expect(await stories(t)).toEqual(['WEB-2']);
    expect(await readFile(join(t.path, 'boards/web/stories/WEB-2/plugins/fixture/note.txt'), 'utf8')).toBe('new');
    expect((await readJsonFile(t, storyFile('WEB-2'))).key).toBe('WEB-2');
  });

  it('takes files queued after the renumbering, by its old or new key, and keeps its stored files', async () => {
    const t = await pluginRoot();
    const story = await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    await mkdir(join(t.path, 'boards/web/stories/WEB-1/plugins/fixture'), { recursive: true });
    await writeFile(join(t.path, 'boards/web/stories/WEB-1/plugins/fixture/kept.txt'), 'K');
    await writeFile(join(t.path, 'boards/web/stories/WEB-1/plugins/fixture/gone.txt'), 'G');
    const changes = changeSet(t);
    changes.recordStory(story, { ...story, key: 'WEB-2' });
    const writer = changes.forPlugin('fixture', lease('fixture'));
    await writer.writeFile({ story: 'WEB-2' }, 'by-new.txt', 'new');
    await writer.writeFile({ story: 'web-1' }, 'by-old.txt', 'old');
    expect(await writer.readFile({ story: 'WEB-2' }, 'kept.txt')).toBe('K');
    await writer.deleteFile({ story: 'WEB-2' }, 'gone.txt');
    const paths = changes.changes.flatMap((c) => (c.type === 'file' ? [c.path] : []));
    expect(paths).toEqual([
      'boards/web/stories/WEB-2/plugins/fixture/by-new.txt',
      'boards/web/stories/WEB-2/plugins/fixture/by-old.txt',
      'boards/web/stories/WEB-2/plugins/fixture/gone.txt',
    ]);
    await changes.save();

    expect(await stories(t)).toEqual(['WEB-2']);
    expect(await readdir(join(t.path, 'boards/web/stories/WEB-2/plugins/fixture'))).toEqual([
      'by-new.txt',
      'by-old.txt',
      'kept.txt',
    ]);
  });

  it('a Plugin cannot change a Story Key or Board through updateStory', async () => {
    const t = await pluginRoot();
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const changes = changeSet(t);
    const writer = changes.forPlugin('fixture', lease('fixture'));
    await expect(writer.updateStory('WEB-1', (s) => ({ ...s, key: 'WEB-9' }))).rejects.toThrow(ValidationError);
    await expect(writer.updateStory('WEB-1', (s) => ({ ...s, boardId: 'api' }))).rejects.toThrow(ValidationError);
    expect(changes.changes).toEqual([]);
  });
});

describe('a Board created in the plan (RES-24)', () => {
  const starter = definePlugin({
    id: 'starter',
    name: 'Starter',
    description: '',
    hooks: {
      'boards.create': {
        async transform({ changes, result }) {
          await changes.writeFile({ board: result.id }, 'welcome.md', '# Welcome');
          expect(await changes.readFile({ board: result.id }, 'welcome.md')).toBe('# Welcome');
        },
      },
    },
  });

  it('can own a file in the same operation, crosscheck.ts', async () => {
    const t = await pluginRoot();
    const changes = changeSet(t);
    const web = await createRepositories(t.root).boards.get('web');
    await changes.putBoard({ ...web, id: 'new', keyPrefix: 'NEW' });
    await changes.forPlugin('fixture', lease('fixture')).writeFile({ board: 'new' }, 'note.txt', 'x');
    await changes.save();
    expect(await readFile(join(t.path, 'boards/new/plugins/fixture/note.txt'), 'utf8')).toBe('x');
  });

  it('commits the Board and its file in one guarded operation', async () => {
    const t = await pluginRoot({ starter: true });
    const { services } = await withPlugins(t, [starter]);
    await services.boards.create({ id: 'api', name: 'API', keyPrefix: 'API' });
    expect(await readFile(join(t.path, 'boards/api/plugins/starter/welcome.md'), 'utf8')).toBe('# Welcome');
    expect(await pathExists(join(t.path, 'boards/api/board.config.json'))).toBe(true);
  });

  it('a guard rejection writes neither the Board nor its file', async () => {
    const veto = definePlugin({
      id: 'veto',
      name: 'Veto',
      description: '',
      hooks: { 'boards.create': { guard: () => ({ reject: 'no new Boards' }) } },
    });
    const t = await pluginRoot({ starter: true, veto: true });
    const { services } = await withPlugins(t, [starter, veto]);
    const before = await snapshotTree(t.path);
    await expect(services.boards.create({ id: 'api', name: 'API', keyPrefix: 'API' })).rejects.toThrow('no new Boards');
    expect(await snapshotTree(t.path)).toEqual(before);
  });
});

describe('Story scopes', () => {
  it('resolve mixed-case Story Keys to one pending file', async () => {
    const t = await pluginRoot();
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const changes = changeSet(t);
    const writer = changes.forPlugin('fixture', lease('fixture'));
    await writer.writeFile({ story: 'web-1' }, 'a.txt', 'one');
    await writer.writeFile({ story: 'Web-1' }, 'a.txt', 'two');
    expect(await writer.readFile({ story: 'WEB-1' }, 'a.txt')).toBe('two');
    expect(changes.changes.filter((c) => c.type === 'file')).toHaveLength(1);
    await changes.save();
    expect(await readFile(join(t.path, 'boards/web/stories/WEB-1/plugins/fixture/a.txt'), 'utf8')).toBe('two');
  });

  it('a Story created in the plan can own a file', async () => {
    const t = await pluginRoot();
    const story = await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const changes = changeSet(t);
    await changes.putStory({ ...story, key: 'WEB-2', name: 'New' });
    await changes.forPlugin('fixture', lease('fixture')).writeFile({ story: 'WEB-2' }, 'a.txt', 'A');
    await changes.save();
    expect(await readFile(join(t.path, 'boards/web/stories/WEB-2/plugins/fixture/a.txt'), 'utf8')).toBe('A');
  });
});
