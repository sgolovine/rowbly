// Which Data Root a run opens, and the known Data Roots of the Home Config (ADR-0033).
import { dirname, join, resolve } from 'node:path';
import { DataRootNotFoundError, UsageError } from '../core';
import type { DataRoot, HomeConfig, KnownDataRoot } from '../schemas';
import { homeConfigPath, readHomeConfig, updateHomeConfig } from './homeConfig';
import { errorCode, io } from './io';

export interface FindDataRootOptions {
  cwd: string;
  /** `--data-root`. */
  flag?: string;
  env: NodeJS.ProcessEnv;
  home: string;
}

const DIR_NAME = '.rowbly';
/** The file `init` writes first; a folder without it is not recorded as a known Data Root. */
const ROOT_CONFIG_FILE = 'rowbly.config.json';
const FLAG_HINT = 'pass `--data-root <path>` with the `.rowbly` folder itself';

/**
 * The Data Root to open (ADR-0033 §1): `--data-root` → the one known Data Root marked `default` in
 * the Home Config → the nearest `.rowbly/` walking up from cwd → `~/.rowbly` → `DataRootNotFoundError`.
 * A named Data Root (the flag or the default) that is missing fails with `details.path` set, never
 * falling back to discovery. Several defaults fail with `USAGE` unless the flag is given.
 */
export async function findDataRoot(opts: FindDataRootOptions): Promise<DataRoot> {
  assertNoRootEnv(opts.env);
  const homeRoot = join(resolve(opts.home), DIR_NAME);
  const toRoot = (path: string): DataRoot => ({ path, kind: path === homeRoot ? 'global' : 'local' });

  if (opts.flag) {
    const path = resolve(opts.cwd, opts.flag);
    if (!(await namedDirectory(path))) {
      throw new DataRootNotFoundError(`Data Root not found: ${path}`, {
        details: { path },
        hint: 'check the path; `--data-root` names the `.rowbly` folder itself',
      });
    }
    return toRoot(path);
  }

  const fallback = await defaultDataRoot(opts.home);
  if (fallback) {
    if (!(await namedDirectory(fallback))) {
      throw new DataRootNotFoundError(`default Data Root not found: ${fallback}`, {
        details: { path: fallback, config: homeConfigPath(opts.home) },
        hint: `fix its entry in ${homeConfigPath(opts.home)}, or ${FLAG_HINT}`,
      });
    }
    // The stored path is canonical; `~/.rowbly` may be reached through a link.
    return toRoot(fallback === (await canonicalDataRootPath(homeRoot, opts.home)) ? homeRoot : fallback);
  }

  for (let dir = resolve(opts.cwd); ; dir = dirname(dir)) {
    const candidate = join(dir, DIR_NAME);
    if (await isDirectory(candidate)) return toRoot(candidate);
    if (dirname(dir) === dir) break;
  }

  if (await isDirectory(homeRoot)) return toRoot(homeRoot);
  throw new DataRootNotFoundError('no Data Root found', {
    hint: 'run `rowbly init` to create one, or pass `--data-root <path>` to use one elsewhere',
  });
}

/** `ROWBLY_ROOT` no longer selects a Data Root; a run that sets it fails rather than open another one. */
export function assertNoRootEnv(env: NodeJS.ProcessEnv): void {
  if (!env.ROWBLY_ROOT) return;
  throw new UsageError('ROWBLY_ROOT is no longer read', {
    details: { ROWBLY_ROOT: env.ROWBLY_ROOT },
    hint: 'unset ROWBLY_ROOT and pass `--data-root <path>` instead',
  });
}

/**
 * The default Data Root's canonical path, `null` when none is marked. More than one entry marked
 * `default` throws `USAGE`, even entries that name one folder: the file says two things.
 */
async function defaultDataRoot(home: string): Promise<string | null> {
  const entries = ((await readHomeConfig(home)).dataRoots ?? []).filter((entry) => entry.default === true);
  if (entries.length > 1) {
    const defaults = entries.map((entry) => entry.path);
    throw new UsageError(`several known Data Roots are marked default: ${defaults.join(', ')}`, {
      details: { config: homeConfigPath(home), defaults },
      hint: `keep one \`"default": true\` in ${homeConfigPath(home)}, or pass \`--data-root <path>\``,
    });
  }
  const [entry] = entries;
  return entry ? canonicalDataRootPath(entry.path, home) : null;
}

/**
 * Where a known Data Root's stored `path` points: `~/` expanded and a relative path resolved against
 * the home folder, then the real path when the folder exists, so that aliases compare equal.
 */
export async function canonicalDataRootPath(path: string, home: string): Promise<string> {
  const expanded = path === '~' || path.startsWith('~/') ? join(home, path.slice(1)) : path;
  const absolute = resolve(home, expanded);
  try {
    return await io.realpath(absolute);
  } catch (err) {
    if (errorCode(err) === 'ENOENT' || errorCode(err) === 'ENOTDIR') return absolute;
    throw err;
  }
}

/**
 * The Home Config's known Data Roots, one per Data Root: each `path` is canonical, and entries that
 * name the same folder are merged as `registerDataRoot` would merge them. The file is not changed.
 */
export async function listKnownDataRoots(home: string): Promise<KnownDataRoot[]> {
  return knownDataRootsOf(await readHomeConfig(home), home);
}

async function knownDataRootsOf(config: HomeConfig, home: string): Promise<KnownDataRoot[]> {
  const merged = new Map<string, KnownDataRoot[]>();
  for (const entry of config.dataRoots ?? []) {
    const path = await canonicalDataRootPath(entry.path, home);
    merged.set(path, [...(merged.get(path) ?? []), entry]);
  }
  return [...merged].map(([path, entries]) => ({ ...mergeEntries(entries), path }));
}

/** `label` and `default` given to `registerDataRoot`; a key left out keeps the stored value. */
export interface RegisterDataRootOptions {
  label?: string;
  /** `true` makes this the only default; `false` clears it. */
  default?: boolean;
}

/**
 * Records the Data Root folder `path` in the Home Config's `dataRoots` and returns its entry. A new
 * folder is appended with its canonical path. Without options, a folder already known under any
 * alias is left exactly as stored (the merged entry is returned), so opening a Data Root never
 * repairs the file, several defaults included. With `label` or `default`, entries naming the folder
 * are merged into the first, keeping its stored path, the first label, `default` if any had it, and
 * every unknown key, then the options apply. Nothing is written, and no lock is taken, when nothing
 * changes, so a home folder Rowbly may not write only fails when there is something to record.
 */
export async function registerDataRoot(
  home: string,
  path: string,
  options: RegisterDataRootOptions = {},
): Promise<KnownDataRoot> {
  const target = await canonicalDataRootPath(resolve(path), home);
  const current = await readHomeConfig(home);
  const planned = await withDataRoot(current, home, target, options);
  if (planned.config === current) return planned.entry;
  let entry = planned.entry;
  await updateHomeConfig(home, async (config) => {
    const next = await withDataRoot(config, home, target, options);
    entry = next.entry;
    return next.config;
  });
  return entry;
}

/** `config` with `target` recorded; the same object when nothing changes. */
async function withDataRoot(
  config: HomeConfig,
  home: string,
  target: string,
  options: RegisterDataRootOptions,
): Promise<{ config: HomeConfig; entry: KnownDataRoot }> {
  const entries = config.dataRoots ?? [];
  const matches: number[] = [];
  for (const [i, entry] of entries.entries()) {
    if ((await canonicalDataRootPath(entry.path, home)) === target) matches.push(i);
  }
  const first = matches[0];
  const explicit = options.label !== undefined || options.default !== undefined;
  if (first !== undefined && !explicit) {
    return { config, entry: mergeEntries(matches.map((i) => entries[i] as KnownDataRoot)) };
  }
  const found = first === undefined ? { path: target } : mergeEntries(matches.map((i) => entries[i] as KnownDataRoot));
  const entry: KnownDataRoot = { ...found };
  if (options.label !== undefined) entry.label = options.label;
  if (options.default === true) entry.default = true;
  if (options.default === false) delete entry.default;

  const unchanged =
    matches.length === 1 && first !== undefined && JSON.stringify(entries[first]) === JSON.stringify(entry);
  const othersDefault = options.default === true && entries.some((e, i) => i !== first && e.default === true);
  if (unchanged && !othersDefault) return { config, entry };

  const dataRoots: KnownDataRoot[] = [];
  for (const [i, stored] of entries.entries()) {
    if (i === first) dataRoots.push(entry);
    else if (matches.includes(i)) continue;
    else if (options.default === true && stored.default === true) {
      const { default: _default, ...rest } = stored;
      dataRoots.push(rest as KnownDataRoot);
    } else dataRoots.push(stored);
  }
  if (first === undefined) dataRoots.push(entry);
  return { config: { ...config, dataRoots }, entry };
}

/** Entries naming one folder as one: each key from the first entry that has it, `default` if any has it. */
function mergeEntries(entries: readonly KnownDataRoot[]): KnownDataRoot {
  if (entries.length === 1) return entries[0] as KnownDataRoot;
  const merged = Object.assign({}, ...[...entries].reverse()) as KnownDataRoot;
  if (entries.some((e) => e.default === true)) merged.default = true;
  return merged;
}

/**
 * Records a Data Root this run opened, unless the folder is not a Data Root yet (no
 * `rowbly.config.json`), so that a mistyped `--data-root` is not remembered.
 */
export async function recordOpenedDataRoot(home: string, root: DataRoot): Promise<void> {
  if (!(await isFile(join(root.path, ROOT_CONFIG_FILE)))) return;
  await registerDataRoot(home, root.path);
}

/**
 * Whether a Data Root that was named (by the flag or the default) is a folder. A missing path is
 * `false`; one Rowbly may not look at fails with `USAGE` rather than reading as missing.
 */
async function namedDirectory(path: string): Promise<boolean> {
  try {
    return (await io.stat(path)).isDirectory();
  } catch (err) {
    const code = errorCode(err);
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    throw new UsageError(`cannot open the Data Root ${path}: ${(err as Error).message}`, {
      details: { path, errno: code },
      hint: `check that you may read ${path}`,
      cause: err,
    });
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await io.stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await io.stat(path)).isFile();
  } catch {
    return false;
  }
}
