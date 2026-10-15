// The symlink policy of ADR-0019 §10 (W5: RES-21, SEC-02). Rowbly assumes a trusted filesystem: a
// symlinked Data Root is allowed, but inside a Plugin scope (`plugins/<id>/`, every folder beneath
// it on the way to a file, and the file) a symbolic link is rejected for read, write, list and
// delete. These are check-then-use tests that catch accidental links. They are not race-proof
// against someone swapping links concurrently, and they confine nothing against malicious code.
// WP02A calls them when the Change Set resolves Plugin file paths.
import { join } from 'node:path';
import { isSlug, ValidationError } from '../core';
import { errorCode, io } from './io';

/** The canonical Data Root (realpath). Containment checks and lock and journal paths use it. */
export function canonicalDataRoot(root: string): Promise<string> {
  return io.realpath(root);
}

/**
 * The physical path of Plugin `plugin`'s file `name` in the record folder `folder` (the Data Root,
 * a Board folder or a Story folder). `name` is a relative `/`-separated name without `.` or `..`
 * segments. Every existing component from `folder/plugins` down to the file is checked with
 * `lstat`; a symbolic link throws `ValidationError`. The record folder itself is not checked: a
 * linked Data Root or record folder is allowed.
 */
export async function resolvePluginFile(folder: string, plugin: string, name: string): Promise<string> {
  const segments = name.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..' || s.includes('\\')) || name.startsWith('/')) {
    throw new ValidationError(`invalid Plugin file name "${name}"`, { details: { plugin, name } });
  }
  await checkNoLinks(folder, ['plugins', checkedId(plugin), ...segments], plugin, name);
  return join(folder, 'plugins', plugin, ...segments);
}

/**
 * Every file of Plugin `plugin` in the record folder `folder`, as sorted `/`-separated names. A
 * linked `plugins/` or `plugins/<id>/` folder throws `ValidationError`; linked entries further down
 * are left out, with nothing behind them. A missing folder has no files.
 */
export async function listPluginFiles(folder: string, plugin: string): Promise<string[]> {
  if (!(await checkNoLinks(folder, ['plugins', checkedId(plugin)], plugin, ''))) return [];
  const files: string[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    for (const entry of await io.readdir(dir)) {
      const path = join(dir, entry);
      const info = await io.lstat(path);
      if (info.isDirectory()) await walk(path, `${prefix}${entry}/`);
      else if (info.isFile()) files.push(`${prefix}${entry}`);
    }
  }
  await walk(join(folder, 'plugins', plugin), '');
  return files.sort();
}

/** The text of Plugin `plugin`'s file `name` in `folder`, or `null` when it does not exist. */
export async function readPluginFile(folder: string, plugin: string, name: string): Promise<string | null> {
  const path = await resolvePluginFile(folder, plugin, name);
  try {
    return await io.readFile(path);
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return null;
    throw err;
  }
}

function checkedId(plugin: string): string {
  if (isSlug(plugin)) return plugin;
  throw new ValidationError(`invalid Plugin id "${plugin}"`, { details: { plugin } });
}

/**
 * `lstat`s `folder/<parts…>` one component at a time. Throws on a symbolic link; returns false at
 * the first missing component (nothing below it can exist), true when every component exists.
 */
async function checkNoLinks(folder: string, parts: readonly string[], plugin: string, name: string): Promise<boolean> {
  let path = folder;
  for (const part of parts) {
    path = join(path, part);
    let linked: boolean;
    try {
      linked = (await io.lstat(path)).isSymbolicLink();
    } catch (err) {
      if (errorCode(err) === 'ENOENT') return false;
      throw err;
    }
    if (linked) {
      const what = name ? `file ${name}` : 'folder';
      throw new ValidationError(
        `Plugin "${plugin}" ${what} is reached through a symbolic link, which Rowbly does not follow`,
        {
          details: { plugin, name, link: path },
        },
      );
    }
  }
  return true;
}
