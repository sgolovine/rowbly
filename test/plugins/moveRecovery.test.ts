// RES-04, engine part: Story folder moves are checked as a whole before any folder moves, and a
// handled failure never leaves a hidden `.moving` folder behind. WP02A adds the Change Set part.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConflictError } from '../../src/core';
import { moveFolders } from '../../src/storage';
import { io } from '../../src/storage/io';
import { tempRoot } from '../helpers';
import { snapshotTree } from '../storage/engineHelpers';

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
