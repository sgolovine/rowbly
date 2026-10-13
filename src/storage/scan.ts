// Raw access to the Data Root for `doctor`, which must see the files that repositories skip
// (unknown files, conflict markers, id/path mismatches) instead of failing on them.
import { readdir, readFile, rm } from 'node:fs/promises';
import { join, sep } from 'node:path';
import type { DataRoot } from '../schemas';

/** Every file under the Data Root, as sorted `/`-separated paths relative to it. */
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
    .sort();
}

/** The text of a file, by its path relative to the Data Root. */
export function readDataRootFile(root: DataRoot, relPath: string): Promise<string> {
  return readFile(join(root.path, relPath), 'utf8');
}

/** Deletes a file by its path relative to the Data Root; a missing file is not an error. */
export async function removeDataRootFile(root: DataRoot, relPath: string): Promise<void> {
  await rm(join(root.path, relPath), { force: true });
}
