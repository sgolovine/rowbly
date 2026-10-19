import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DataIntegrityError, NotFoundError, ValidationError } from '../../src/core';
import { BoardConfigSchema, type Story, StorySchema } from '../../src/schemas';
import { readJson, writeJson } from '../../src/storage';
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

  it('is byte-for-byte stable when writing the same parsed value twice', async () => {
    const t = await tempRoot();
    const path = join(t.path, 'story.json');
    const story: Story = StorySchema.parse({
      version: 1,
      key: 'WEB-1',
      boardId: 'web',
      name: 'First',
      stage: 'todo',
      rank: 'a0',
      epicId: null,
      priority: 'P1',
      labels: ['ui'],
      dueDate: '2026-11-01',
      customFields: { points: 3, env: ['dev'] },
      createdBy: null,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      nextTaskNumber: 1,
      tasks: [],
      comments: [],
    });
    await writeJson(path, StorySchema, story);
    const first = await readFile(path);
    await writeJson(path, StorySchema, await readJson(path, StorySchema));
    expect((await readFile(path)).equals(first)).toBe(true);
  });

  it('rejects an invalid value with ValidationError and writes nothing', async () => {
    const t = await tempRoot();
    const path = join(t.path, 'board.json');
    await expect(writeJson(path, BoardConfigSchema, { ...board, id: 'Not A Slug' })).rejects.toThrow(ValidationError);
    await expect(readFile(path)).rejects.toThrow();
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
  it('ENOENT is NotFoundError', async () => {
    const t = await tempRoot();
    await expect(readJson(join(t.path, 'missing.json'), BoardConfigSchema)).rejects.toThrow(NotFoundError);
  });

  it('malformed JSON is DataIntegrityError with details.path', async () => {
    const t = await tempRoot();
    const path = join(t.path, 'bad.json');
    await writeFile(path, '{ "version": 1,');
    const err = await readJson(path, BoardConfigSchema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DataIntegrityError);
    expect((err as DataIntegrityError).details).toEqual({ path });
  });

  it('a schema failure is DataIntegrityError with details.path and the zod issues', async () => {
    const t = await tempRoot();
    const path = join(t.path, 'board.json');
    await writeFile(path, JSON.stringify({ ...board, id: 'Bad Id' }));
    const err = (await readJson(path, BoardConfigSchema).catch((e: unknown) => e)) as DataIntegrityError;
    expect(err).toBeInstanceOf(DataIntegrityError);
    expect(err.details.path).toBe(path);
    expect(err.details.issues).toEqual([expect.objectContaining({ path: ['id'] })]);
  });

  it('a file with git conflict markers is DataIntegrityError with conflict: true', async () => {
    const t = await tempRoot();
    const path = join(t.path, 'board.json');
    await writeFile(path, '{\n<<<<<<< HEAD\n  "name": "Ours"\n=======\n  "name": "Theirs"\n>>>>>>> feature\n}\n');
    const err = (await readJson(path, BoardConfigSchema).catch((e: unknown) => e)) as DataIntegrityError;
    expect(err).toBeInstanceOf(DataIntegrityError);
    expect(err.details).toEqual({ path, conflict: true });
  });
});
