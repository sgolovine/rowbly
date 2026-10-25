// The files of agent skills that `rowbly skills` creates and lists, outside any Data Root.
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConflictError, NotFoundError } from '../core';
import { errorCode, io } from './io';
import { pathExists, readTextFile, writeTextFile } from './system';

/**
 * The text of a file shipped in the Rowbly package (for example `skills/rowbly-reference.md`), found
 * by walking up from this module: from `dist/` in the built CLI, from `src/storage/` under `tsx`.
 */
export async function readPackageFile(relativePath: string): Promise<string> {
  for (let dir = dirname(fileURLToPath(import.meta.url)); ; dir = dirname(dir)) {
    const candidate = join(dir, relativePath);
    if (await pathExists(candidate)) return readTextFile(candidate);
    if (dirname(dir) === dir) throw new NotFoundError(`${relativePath} is missing from the Rowbly package`);
  }
}

/**
 * Creates the folder `dir` holding `files` (paths relative to it). The files are written to a
 * temporary folder beside it, which is renamed to `dir` only once complete, so a failed write leaves
 * no half-made folder. An existing `dir` is a `ConflictError`.
 */
export async function createFolder(dir: string, files: Record<string, string>): Promise<void> {
  if (await pathExists(dir)) throw new ConflictError(`${dir} already exists`, { details: { path: dir } });
  const temp = join(dirname(dir), `.${randomBytes(4).toString('hex')}.tmp`);
  try {
    for (const [path, text] of Object.entries(files)) await writeTextFile(join(temp, path), text);
    if (await pathExists(dir)) throw new ConflictError(`${dir} already exists`, { details: { path: dir } });
    await io.rename(temp, dir);
  } catch (err) {
    await io.rm(temp).catch(() => undefined);
    throw err;
  }
}

/**
 * The names of the folders in `dir` that hold every file in `required`, sorted; a missing `dir` has
 * none. With the text of the first required file, so that callers can read its frontmatter.
 */
export async function listFoldersWith(
  dir: string,
  required: readonly [string, ...string[]],
): Promise<{ name: string; text: string }[]> {
  let names: string[];
  try {
    names = await io.readdir(dir);
  } catch (err) {
    if (errorCode(err) === 'ENOENT' || errorCode(err) === 'ENOTDIR') return [];
    throw err;
  }
  const found: { name: string; text: string }[] = [];
  for (const name of names.sort()) {
    const files = required.map((file) => join(dir, name, file));
    const present = await Promise.all(files.map(pathExists));
    if (present.every(Boolean)) found.push({ name, text: await readTextFile(files[0] as string) });
  }
  return found;
}
