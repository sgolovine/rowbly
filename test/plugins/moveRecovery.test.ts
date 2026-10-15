// RES-04: Story folder moves are checked as a whole before any folder moves, and a handled failure
// never leaves a hidden `.moving` folder behind. The engine part is WP02B's; the Change Set part
// (doctor renumbering through the transaction engine) is WP02A's.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConflictError } from '../../src/core';
import { StorySchema } from '../../src/schemas';
import { CoreChangeSet } from '../../src/services/plugins/changeSet';
import { createRepositories, moveFolders, recoverTransactions } from '../../src/storage';
import { io } from '../../src/storage/io';
import { makeStory, tempRoot, writeFixture } from '../helpers';
import { injectFaults, snapshotTree } from '../storage/engineHelpers';
import { pluginRoot, withPlugins } from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
});

/** A Board's stories folder with WEB-1…WEB-n, each holding a story.json and a Plugin file. */
async function storiesDir(...keys: string[]): Promise<string> {
  const t = await tempRoot();
  const dir = join(t.path, 'boards', 'web', 'stories');
  for (const key of keys) {
    await mkdir(join(dir, key, 'plugins', 'specs'), { recursive: true });
    await writeFile(join(dir, key, 'story.json'), `{"key":"${key}"}\n`);
    await writeFile(join(dir, key, 'plugins', 'specs', 'note.md'), `note of ${key}\n`);
  }
  return dir;
}

function hiddenFolders(tree: Record<string, string>): string[] {
  return Object.keys(tree).filter((path) => path.includes('.moving'));
}

describe('moveFolders', () => {
  it('rejects an occupied destination before moving any source (r04)', async () => {
    const dir = await storiesDir('WEB-2', 'WEB-3');
    // WEB-8 is an orphan folder: a Spec file but no story.json.
    await mkdir(join(dir, 'WEB-8', 'plugins', 'specs'), { recursive: true });
    await writeFile(join(dir, 'WEB-8', 'plugins', 'specs', 'orphan.md'), 'orphan\n');
    const before = await snapshotTree(dir);

    await expect(
      moveFolders([
        { from: join(dir, 'WEB-2'), to: join(dir, 'WEB-4') },
        { from: join(dir, 'WEB-3'), to: join(dir, 'WEB-8') },
      ]),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await snapshotTree(dir)).toEqual(before);
  });

  it('swaps two folders in one set', async () => {
    const dir = await storiesDir('WEB-1', 'WEB-2');
    await moveFolders([
      { from: join(dir, 'WEB-1'), to: join(dir, 'WEB-2') },
      { from: join(dir, 'WEB-2'), to: join(dir, 'WEB-1') },
    ]);
    const after = await snapshotTree(dir);
    expect(after['WEB-1/story.json']).toBe('{"key":"WEB-2"}\n');
    expect(after['WEB-2/story.json']).toBe('{"key":"WEB-1"}\n');
    expect(after['WEB-1/plugins/specs/note.md']).toBe('note of WEB-2\n');
    expect(hiddenFolders(after)).toEqual([]);
  });

  it('moves a chain where each destination is vacated by the next move', async () => {
    const dir = await storiesDir('WEB-1', 'WEB-2');
    await moveFolders([
      { from: join(dir, 'WEB-1'), to: join(dir, 'WEB-2') },
      { from: join(dir, 'WEB-2'), to: join(dir, 'WEB-3') },
    ]);
    const after = await snapshotTree(dir);
    expect(after['WEB-2/story.json']).toBe('{"key":"WEB-1"}\n');
    expect(after['WEB-3/story.json']).toBe('{"key":"WEB-2"}\n');
    expect(after['WEB-1']).toBeUndefined();
  });

  it('rejects two moves to one destination, a source moved twice and a missing source', async () => {
    const dir = await storiesDir('WEB-1', 'WEB-2');
    const before = await snapshotTree(dir);
    const to = join(dir, 'WEB-5');
    await expect(
      moveFolders([
        { from: join(dir, 'WEB-1'), to },
        { from: join(dir, 'WEB-2'), to },
      ]),
    ).rejects.toThrow(/two folders are moved to/);
    await expect(
      moveFolders([
        { from: join(dir, 'WEB-1'), to },
        { from: join(dir, 'WEB-1'), to: join(dir, 'WEB-6') },
      ]),
    ).rejects.toThrow(/moved twice/);
    await expect(moveFolders([{ from: join(dir, 'WEB-9'), to }])).rejects.toThrow(/does not exist/);
    expect(await snapshotTree(dir)).toEqual(before);
  });

  it('puts every folder back when staging the second source fails', async () => {
    const dir = await storiesDir('WEB-1', 'WEB-2');
    const before = await snapshotTree(dir);
    const rename = io.rename;
    let calls = 0;
    vi.spyOn(io, 'rename').mockImplementation(async (from, to) => {
      calls += 1;
      if (calls === 2) throw Object.assign(new Error('EIO'), { code: 'EIO' });
      return rename(from, to);
    });

    await expect(
      moveFolders([
        { from: join(dir, 'WEB-1'), to: join(dir, 'WEB-3') },
        { from: join(dir, 'WEB-2'), to: join(dir, 'WEB-4') },
      ]),
    ).rejects.toMatchObject({ code: 'EIO' });
    expect(await snapshotTree(dir)).toEqual(before);
  });

  it('puts every folder back when placing the second destination fails', async () => {
    const dir = await storiesDir('WEB-1', 'WEB-2');
    const before = await snapshotTree(dir);
    const rename = io.rename;
    let calls = 0;
    vi.spyOn(io, 'rename').mockImplementation(async (from, to) => {
      calls += 1;
      // Calls 1–2 stage both sources, call 3 places the first, call 4 fails placing the second.
      if (calls === 4) throw Object.assign(new Error('EIO'), { code: 'EIO' });
      return rename(from, to);
    });

    await expect(
      moveFolders([
        { from: join(dir, 'WEB-1'), to: join(dir, 'WEB-2') },
        { from: join(dir, 'WEB-2'), to: join(dir, 'WEB-1') },
      ]),
    ).rejects.toMatchObject({ code: 'EIO' });
    expect(await snapshotTree(dir)).toEqual(before);
  });

  it('reports the folders it could not put back as a DATA_INTEGRITY error', async () => {
    const dir = await storiesDir('WEB-1', 'WEB-2');
    const rename = io.rename;
    let calls = 0;
    vi.spyOn(io, 'rename').mockImplementation(async (from, to) => {
      calls += 1;
      if (calls >= 2) throw Object.assign(new Error('EIO'), { code: 'EIO' });
      return rename(from, to);
    });

    const err = await moveFolders([
      { from: join(dir, 'WEB-1'), to: join(dir, 'WEB-3') },
      { from: join(dir, 'WEB-2'), to: join(dir, 'WEB-4') },
    ]).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'DATA_INTEGRITY' });
    expect((err as { details: { paths: string[] } }).details.paths).toEqual([expect.stringMatching(/\.moving$/)]);
  });
});

describe('renumbering through the Change Set', () => {
  /** WEB-1 twice: the later one in folder WEB-7, so doctor renumbers it to WEB-8 (r04). */
  async function duplicateKeys() {
    const t = await pluginRoot();
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Kept' });
    const later = await makeStory(t.path, {
      boardId: 'web',
      key: 'WEB-1',
      name: 'Moved',
      rank: 'a1',
      createdAt: '2026-10-13T00:00:00.000Z',
    });
    await writeFixture(join(t.path, 'boards/web/stories/WEB-7/story.json'), StorySchema, later);
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Kept' });
    return t;
  }

  it('an occupied target fails before any folder moves; every Story stays readable (r04)', async () => {
    const t = await duplicateKeys();
    // A stray folder at the key doctor picks next: a leftover Spec, no story.json.
    await mkdir(join(t.path, 'boards/web/stories/WEB-8/plugins/specs'), { recursive: true });
    await writeFile(join(t.path, 'boards/web/stories/WEB-8/plugins/specs/spec.md'), '# old');
    const { services } = await withPlugins(t, []);
    const before = await snapshotTree(t.path);

    await expect(services.doctor.fix()).rejects.toThrow(ConflictError);
    expect(await snapshotTree(t.path)).toEqual(before);
    expect(hiddenFolders(await snapshotTree(t.path))).toEqual([]);
    // Both Stories are still where they were: nothing is hidden in a `.moving` folder.
    expect((await services.stories.get('WEB-1')).name).toBe('Kept');
    expect((await services.doctor.check()).findings.map((f) => f.code)).toContain('DUPLICATE_KEY');
  });

  it('a crash at any step of a swap with Plugin files recovers to the old or new state', async () => {
    async function swap() {
      const t = await pluginRoot();
      const one = await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'One' });
      const two = await makeStory(t.path, { boardId: 'web', key: 'WEB-2', name: 'Two' });
      for (const key of ['WEB-1', 'WEB-2']) {
        await mkdir(join(t.path, `boards/web/stories/${key}/plugins/notes`), { recursive: true });
        await writeFile(join(t.path, `boards/web/stories/${key}/plugins/notes/n.txt`), `note of ${key}`);
      }
      const changes = new CoreChangeSet(t.root, createRepositories(t.root));
      changes.recordStory(one, { ...one, key: 'WEB-2' });
      changes.recordStory(two, { ...two, key: 'WEB-1' });
      return { t, run: () => changes.save() };
    }
    const clean = await swap();
    const before = await snapshotTree(clean.t.path);
    const counting = injectFaults();
    await clean.run();
    counting.restore();
    const after = await snapshotTree(clean.t.path);
    expect(after['boards/web/stories/WEB-2/plugins/notes/n.txt']).toBe('note of WEB-1');

    for (let n = 1; n <= counting.calls; n++) {
      const { t, run } = await swap();
      const faults = injectFaults();
      faults.crashAt(n);
      await run().catch(() => undefined);
      faults.restore();
      await recoverTransactions(t.path);
      expect([before, after], `call ${n}`).toContainEqual(await snapshotTree(t.path));
    }
  }, 60_000);
});
