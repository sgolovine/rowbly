// RES-03: a failed text write never truncates the original file (ADR-0019 §3).
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardConfigSchema } from '../../src/schemas';
import { writeJson, writeTextFile } from '../../src/storage';
import { io } from '../../src/storage/io';
import { FIXED_NOW, tempRoot } from '../helpers';
import { fixtureScript, runScript } from './engineHelpers';

const ORIGINAL = `# Spec\n\n${'old line\n'.repeat(500)}`;

afterEach(() => {
  vi.restoreAllMocks();
});

async function specFile(): Promise<{ dir: string; file: string }> {
  const t = await tempRoot();
  const dir = join(t.path, 'plugins', 'specs');
  const file = join(dir, 'spec.md');
  await writeTextFile(file, ORIGINAL);
  return { dir, file };
}

describe('writeTextFile', () => {
  it('keeps every original byte, the final newline included, when the write fails part way', async () => {
    const { dir, file } = await specFile();
    const real = io.writeFile;
    vi.spyOn(io, 'writeFile').mockImplementation(async (path, text, flag) => {
      // A short write: half the bytes land, then the disk is full.
      await real(path, text.slice(0, text.length / 2), flag);
      throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
    });

    await expect(writeTextFile(file, 'NEW'.repeat(10_000))).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(await readFile(file, 'utf8')).toBe(ORIGINAL);
    expect(await readdir(dir)).toEqual(['spec.md']);
  });

  it('keeps the original when the rename fails', async () => {
    const { dir, file } = await specFile();
    vi.spyOn(io, 'rename').mockRejectedValue(Object.assign(new Error('EIO'), { code: 'EIO' }));

    await expect(writeTextFile(file, 'new')).rejects.toMatchObject({ code: 'EIO' });
    expect(await readFile(file, 'utf8')).toBe(ORIGINAL);
    expect(await readdir(dir)).toEqual(['spec.md']);
  });

  it('rethrows the original error when cleaning up the temporary file also fails', async () => {
    const { file } = await specFile();
    const original = Object.assign(new Error('EIO'), { code: 'EIO' });
    vi.spyOn(io, 'rename').mockRejectedValue(original);
    vi.spyOn(io, 'rm').mockRejectedValue(new Error('cleanup failed'));

    await expect(writeTextFile(file, 'new')).rejects.toBe(original);
    expect(await readFile(file, 'utf8')).toBe(ORIGINAL);
  });

  it('replaces the whole file on success and leaves no temporary file', async () => {
    const { dir, file } = await specFile();
    await writeTextFile(file, 'short\n');
    expect(await readFile(file, 'utf8')).toBe('short\n');
    expect(await readdir(dir)).toEqual(['spec.md']);
  });

  it('creates missing folders', async () => {
    const t = await tempRoot();
    const file = join(t.path, 'a', 'b', 'c.md');
    await writeTextFile(file, 'x');
    expect(await readFile(file, 'utf8')).toBe('x');
  });

  it('writes JSON with the same atomic replacement and keeps its formatting', async () => {
    const t = await tempRoot();
    const file = join(t.path, 'board.config.json');
    const board = BoardConfigSchema.parse({
      version: 1,
      id: 'web',
      name: 'Web',
      description: '',
      keyPrefix: 'WEB',
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    });
    await writeJson(file, BoardConfigSchema, board);
    const before = await readFile(file, 'utf8');
    expect(before.endsWith('}\n')).toBe(true);

    vi.spyOn(io, 'writeFile').mockRejectedValue(Object.assign(new Error('EFBIG'), { code: 'EFBIG' }));
    await expect(writeJson(file, BoardConfigSchema, { ...board, name: 'Two' })).rejects.toMatchObject({
      code: 'EFBIG',
    });
    expect(await readFile(file, 'utf8')).toBe(before);
    expect(await readdir(t.path)).toEqual(['board.config.json', 'rowbly.config.json']);
  });

  // The review's text-failure.ts: a real file-size limit in a subprocess.
  it.skipIf(process.platform === 'win32')('keeps the original under a real file-size limit (ulimit -f)', async () => {
    const t = await tempRoot();
    const file = join(t.path, 'spec.md');
    const old = `${'OLD'.repeat(10_000)}\n`;
    await writeFile(file, old);

    const result = await runScript(fixtureScript('writeText.ts'), [file, '300000'], { shell: 'ulimit -f 2;' });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/EFBIG|File too large/);
    expect(await readFile(file, 'utf8')).toBe(old);
    expect(await readdir(t.path)).toEqual(['rowbly.config.json', 'spec.md']);
  });
});
