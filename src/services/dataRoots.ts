// The known Data Roots of the Home Config as the TUI's Data Root switcher shows and opens them (ADR-0033 §2).
import { join } from 'node:path';
import { DataIntegrityError, DataRootNotFoundError } from '../core';
import { type DataRoot, type KnownDataRoot, RowblyConfigSchema } from '../schemas';
import { canonicalDataRootPath, homeConfigPath, listKnownDataRoots, pathExists, readJson } from '../storage';
import { createContext } from './index';
import { shellArg } from './setup';
import type { RowblyContext } from './types';

/** A known Data Root, as the switcher lists it. */
export interface KnownDataRootChoice extends KnownDataRoot {
  /** The Data Root the app has open. */
  current: boolean;
  /** `~/.rowbly`. */
  global: boolean;
  /** No `rowbly.config.json` at its path: moved, removed or never finished. */
  missing: boolean;
}

/**
 * The Home Config's known Data Roots, in its order, each marked current, global or missing. The
 * Data Root open now is listed first when the Home Config does not have it (it could not be recorded).
 */
export async function knownDataRoots(home: string, current: DataRoot | null): Promise<KnownDataRootChoice[]> {
  const known = await listKnownDataRoots(home);
  const currentPath = current ? await canonicalDataRootPath(current.path, home) : null;
  const globalPath = await canonicalDataRootPath(join(home, '.rowbly'), home);
  const listed =
    currentPath && !known.some((entry) => entry.path === currentPath) ? [{ path: currentPath }, ...known] : known;
  return Promise.all(
    listed.map(async (entry) => ({
      ...entry,
      current: entry.path === currentPath,
      global: entry.path === globalPath,
      missing: !(await pathExists(join(entry.path, 'rowbly.config.json'))),
    })),
  );
}

/**
 * Opens the known Data Root at `path` as `--data-root` would, with its Local State and Me. It reads
 * `rowbly.config.json` first, so a Data Root that is gone or broken fails here, naming what to do,
 * before the app leaves the one it has open. The Home Config's labels and default stay as they are.
 */
export async function openKnownDataRoot(opts: {
  path: string;
  home: string;
  cwd: string;
  warn(message: string): void;
}): Promise<RowblyContext> {
  const config = join(opts.path, 'rowbly.config.json');
  if (!(await pathExists(config))) {
    throw new DataRootNotFoundError(`Data Root not found: ${opts.path}`, {
      details: { path: opts.path, config: homeConfigPath(opts.home) },
      hint: `it is listed in ${homeConfigPath(opts.home)}; restore it, create it again with \`rowbly init --data-root ${shellArg(opts.path)}\`, or remove its entry there`,
    });
  }
  try {
    await readJson(config, RowblyConfigSchema);
    return await createContext({ cwd: opts.cwd, env: {}, home: opts.home, root: opts.path, warn: opts.warn });
  } catch (err) {
    if (!(err instanceof DataIntegrityError) || err.hint) throw err;
    throw new DataIntegrityError(err.message, {
      details: err.details,
      hint: `run \`rowbly --data-root ${shellArg(opts.path)} doctor\``,
      cause: err,
    });
  }
}
