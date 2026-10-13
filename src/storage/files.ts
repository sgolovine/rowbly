// Plain file access for Plugin files and for saving Change Sets.
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, rmdir } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

/** The text of a file, or `null` when it does not exist. */
export async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Every file under `dir`, as sorted `/`-separated paths relative to it; a missing folder has none. */
export async function listFilesUnder(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
      .sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/** Deletes a file (a missing one is fine) and then its folders up to `stopAt` while they are empty. */
export async function removeFile(path: string, stopAt: string): Promise<void> {
  await rm(path, { force: true });
  for (let dir = dirname(path); dir.startsWith(stopAt) && dir !== stopAt; dir = dirname(dir)) {
    try {
      await rmdir(dir);
    } catch {
      // Not empty (or already gone): keep it and everything above it.
      return;
    }
  }
}

/**
 * Moves folders, through temporary names first, so that one folder may move to where another one
 * is moving away from.
 */
export async function moveFolders(moves: readonly { from: string; to: string }[]): Promise<void> {
  const staged: { temp: string; to: string }[] = [];
  for (const { from, to } of moves) {
    const temp = join(dirname(from), `.${randomBytes(4).toString('hex')}.moving`);
    await rename(from, temp);
    staged.push({ temp, to });
  }
  for (const { temp, to } of staged) {
    await mkdir(dirname(to), { recursive: true });
    await rename(temp, to);
  }
}
