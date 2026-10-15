// Raw access to the Data Root for `doctor`, which must see the files that repositories skip
// (unknown files, conflict markers, id/path mismatches) instead of failing on them.
import { readdir, readFile, rm, rmdir } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import type { DataRoot } from '../schemas';

/**
 * The Data Root lock of the running process, and of one that is taking it right now (ADR-0019 §1).
 * Doctor runs under the lock, so it would otherwise always see its own lock file. A stale lock is
 * not a finding either: the next acquisition breaks it.
 */
const LOCK_FILES_RE = /^\.lock(\.break)?$|^\.lock(\.break)?\.[0-9a-f]{8}\.tmp$/;

/** Every file under the Data Root but the lock files, as sorted `/`-separated paths relative to it. */
export async function listDataRootFiles(root: DataRoot): Promise<string[]> {
  const entries = await readdir(root.path, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(root.path.length + 1)
        .split(sep)
        .join('/'),
    )
    .filter((path) => !LOCK_FILES_RE.test(path))
    .sort();
}

/** The text of a file, by its path relative to the Data Root. */
export function readDataRootFile(root: DataRoot, relPath: string): Promise<string> {
  return readFile(join(root.path, relPath), 'utf8');
}

/**
 * Deletes a file by its path relative to the Data Root, and its folder when that is left empty.
 * A missing file is not an error.
 */
export async function removeDataRootFile(root: DataRoot, relPath: string): Promise<void> {
  const path = join(root.path, relPath);
  await rm(path, { force: true });
  try {
    await rmdir(dirname(path));
  } catch {
    // The folder still holds other files (or is already gone); keep it.
  }
}
