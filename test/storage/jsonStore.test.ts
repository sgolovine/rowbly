import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DataIntegrityError } from '../../src/core';
import { BoardConfigSchema } from '../../src/schemas';
import {
  ensureHomeConfig,
  HOME_CONFIG_FILE,
  readHomeConfig,
  readJson,
  updateHomeConfig,
  writeJson,
} from '../../src/storage';
import { io } from '../../src/storage/io';
import { FIXED_NOW, tempRoot } from '../helpers';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

const board = {
  version: 1 as const,
  id: 'web',
  name: 'Web',
  description: '',
  keyPrefix: 'WEB',
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
};

describe('writeJson', () => {
  it('writes keys in schema order, 2-space indent and a trailing newline', async () => {
    const t = await tempRoot();
    const path = join(t.path, 'nested', 'dir', 'board.json');
    // Deliberately scrambled key order; unknown keys are dropped.
    const scrambled = {
      extra: true,
      ...Object.fromEntries(Object.entries(board).reverse()),
    } as unknown as typeof board;
    await writeJson(path, BoardConfigSchema, scrambled);
    const text = await readFile(path, 'utf8');
    expect(text).toBe(
      `{\n  "version": 1,\n  "id": "web",\n  "name": "Web",\n  "description": "",\n  "keyPrefix": "WEB",\n` +
        `  "createdAt": "${FIXED_NOW}",\n  "updatedAt": "${FIXED_NOW}"\n}\n`,
    );
  });

  it('is atomic: a failing rename leaves the old file intact and no temp files behind', async () => {
    const t = await tempRoot();
    const path = join(t.path, 'board.json');
    await writeJson(path, BoardConfigSchema, board);
    const before = await readFile(path, 'utf8');

    vi.mocked(rename).mockRejectedValueOnce(new Error('disk full'));
    await expect(writeJson(path, BoardConfigSchema, { ...board, name: 'Changed' })).rejects.toThrow('disk full');

    expect(await readFile(path, 'utf8')).toBe(before);
    expect((await readdir(t.path)).sort()).toEqual(['board.json', 'rowbly.config.json']);
  });
});

describe('readJson', () => {
  it('a file with git conflict markers is DataIntegrityError with conflict: true', async () => {
    const t = await tempRoot();
    const path = join(t.path, 'board.json');
    await writeFile(path, '{\n<<<<<<< HEAD\n  "name": "Ours"\n=======\n  "name": "Theirs"\n>>>>>>> feature\n}\n');
    const err = (await readJson(path, BoardConfigSchema).catch((e: unknown) => e)) as DataIntegrityError;
    expect(err).toBeInstanceOf(DataIntegrityError);
    expect(err.details).toEqual({ path, conflict: true });
  });
});

// ADR-0031: the Home Config, `~/.rowblyrc.json`.
describe('updateHomeConfig', () => {
  it('keeps every concurrent update and unknown keys, and never replaces a file it cannot read', async () => {
    const home = (await tempRoot()).dir;
    const path = join(home, HOME_CONFIG_FILE);
    await writeFile(path, '{ "editor": "vim", "dataRoots": [{ "path": "/a", "note": "kept" }] }\n');
    expect(await ensureHomeConfig(home)).toBe(false);

    // The first update holds the lock until `release`. The second must reach the lock (its realpath
    // call) without its change running; with no lock its change would run first.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let queued!: () => void;
    const secondQueued = new Promise<void>((resolve) => {
      queued = resolve;
    });
    const realpath = io.realpath;
    let calls = 0;
    const spy = vi.spyOn(io, 'realpath').mockImplementation(async (target) => {
      const resolved = await realpath(target);
      if (++calls === 2) queued();
      return resolved;
    });
    const entered: string[] = [];
    const ran: Record<string, () => void> = {};
    const running = (name: string) =>
      new Promise<void>((resolve) => {
        ran[name] = resolve;
      });
    const firstRan = running('first');
    const secondRan = running('second');
    const add = (name: string, wait?: Promise<void>) =>
      updateHomeConfig(home, async (config) => {
        entered.push(name);
        ran[name]?.();
        await wait;
        return { ...config, dataRoots: [...(config.dataRoots ?? []), { path: `/${name}` }] };
      });
    try {
      const first = add('first', held);
      await firstRan;
      const second = add('second');
      await Promise.race([secondQueued, secondRan]);
      expect(entered).toEqual(['first']);
      release();
      await Promise.all([first, second]);
    } finally {
      release();
      spy.mockRestore();
    }
    const saved = await readHomeConfig(home);
    expect(saved).toMatchObject({ version: 1, editor: 'vim' });
    expect(saved.dataRoots?.map((root) => root.path)).toEqual(['/a', '/first', '/second']);
    expect(saved.dataRoots?.[0]).toEqual({ path: '/a', note: 'kept' });
    expect((await readdir(home)).sort()).toEqual(['.rowbly', HOME_CONFIG_FILE]);

    await writeFile(path, '{ "me": "sam",');
    await expect(updateHomeConfig(home, (config) => ({ ...config, me: 'kim' }))).rejects.toBeInstanceOf(
      DataIntegrityError,
    );
    expect(await readFile(path, 'utf8')).toBe('{ "me": "sam",');
  });
});
