import { stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DataRootNotFoundError } from '../core';
import type { DataRoot } from '../schemas';

export interface FindDataRootOptions {
  cwd: string;
  /** `--root`. */
  flag?: string;
  env: NodeJS.ProcessEnv;
  home: string;
}

const DIR_NAME = '.rowbly';

/** `--root` → `ROWBLY_ROOT` → nearest `.rowbly/` walking up from cwd → `~/.rowbly` if it exists → `DataRootNotFoundError`. */
export async function findDataRoot(opts: FindDataRootOptions): Promise<DataRoot> {
  const globalPath = join(resolve(opts.home), DIR_NAME);
  const toRoot = (path: string): DataRoot => ({ path, kind: path === globalPath ? 'global' : 'local' });

  const explicit = opts.flag || opts.env.ROWBLY_ROOT;
  if (explicit) {
    const path = resolve(opts.cwd, explicit);
    if (!(await isDirectory(path))) throw new DataRootNotFoundError(`Data Root not found: ${path}`);
    return toRoot(path);
  }

  for (let dir = resolve(opts.cwd); ; dir = dirname(dir)) {
    const candidate = join(dir, DIR_NAME);
    if (await isDirectory(candidate)) return toRoot(candidate);
    if (dirname(dir) === dir) break;
  }

  if (await isDirectory(globalPath)) return toRoot(globalPath);
  throw new DataRootNotFoundError();
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
