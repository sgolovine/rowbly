// The Home Config, `~/.rowblyrc.json` (ADR-0031): per-user settings beside every Data Root. It is
// replaced atomically under its own lock and never replaced while Rowbly cannot read it.
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { DataIntegrityError, NotFoundError, RowblyError, UsageError } from '../core';
import { type HomeConfig, HomeConfigSchema } from '../schemas';
import { entryExists, errorCode, io } from './io';
import { readJson, serializeJson } from './jsonStore';
import { type AcquireOptions, withLock } from './lock';
import { writeFileAtomic } from './system';

export const HOME_CONFIG_FILE = '.rowblyrc.json';
/** The lock file beside the Home Config; its break file adds `.break`. */
export const HOME_CONFIG_LOCK_FILE = `${HOME_CONFIG_FILE}.lock`;

/** `~/.rowblyrc.json` for the home folder `home`. */
export function homeConfigPath(home: string): string {
  return join(resolve(home), HOME_CONFIG_FILE);
}

/**
 * Creates the Home Config as `{ "version": 1 }` when nothing is at its path, and returns whether it
 * did. It never replaces anything, even a file another process creates at the same moment: the new
 * file is written in full beside it and hard-linked into place only if the name is still free.
 */
export async function ensureHomeConfig(home: string): Promise<boolean> {
  const path = homeConfigPath(home);
  if (await entryExists(path)) return false;
  const temp = join(dirname(path), `.${HOME_CONFIG_FILE}.${randomBytes(4).toString('hex')}.tmp`);
  await io.writeFile(temp, serializeJson(path, HomeConfigSchema, { version: 1 }));
  try {
    await io.link(temp, path);
    await io.syncDir(dirname(path));
    return true;
  } catch (err) {
    if (errorCode(err) === 'EEXIST') return false;
    throw err;
  } finally {
    await io.unlink(temp).catch(() => undefined);
  }
}

/**
 * The Home Config. A missing file is `{ version: 1 }`. A file that is not valid JSON, does not match
 * the schema or is not a file throws `DataIntegrityError` naming it; one Rowbly may not read throws
 * `UsageError`.
 */
export async function readHomeConfig(home: string): Promise<HomeConfig> {
  const path = homeConfigPath(home);
  try {
    return await readJson(path, HomeConfigSchema);
  } catch (err) {
    if (err instanceof NotFoundError) return HomeConfigSchema.parse({});
    if (err instanceof DataIntegrityError) throw unreadable(path, err.message, err.details, err);
    if (errorCode(err) === 'EISDIR') throw unreadable(path, `${path} is not a file`, { path }, err);
    throw inaccessible(path, err);
  }
}

export interface UpdateHomeConfigOptions {
  /** How long to wait for another Rowbly process that is updating it; the lock's default otherwise. */
  timeoutMs?: AcquireOptions['timeoutMs'];
}

/**
 * Reads the Home Config under its lock, passes it to `change` and saves what `change` returns, so
 * that concurrent updates from Rowbly processes each start from the last one's result. Keys Rowbly
 * does not know are kept. Nothing is written when the result is unchanged, or when the stored file
 * cannot be read (that error is thrown). A symlinked Home Config is updated at its target, keeping
 * the link; the new file keeps the old one's permissions. A home folder or file that Rowbly may not
 * write throws `UsageError` naming it. Returns the saved Home Config.
 */
export async function updateHomeConfig(
  home: string,
  change: (config: HomeConfig) => HomeConfig | Promise<HomeConfig>,
  options: UpdateHomeConfigOptions = {},
): Promise<HomeConfig> {
  const path = homeConfigPath(home);
  const lock = { file: HOME_CONFIG_LOCK_FILE, subject: 'Home Config', operation: 'home-config.update', ...options };
  try {
    return await withLock(dirname(path), lock, async () => {
      const current = await readHomeConfig(home);
      const text = serializeJson(path, HomeConfigSchema, await change(structuredClone(current)));
      const saved = HomeConfigSchema.parse(JSON.parse(text));
      if (text === serializeJson(path, HomeConfigSchema, current) && (await entryExists(path))) return saved;
      const target = await writeTarget(path);
      await writeFileAtomic(target.path, text, target.mode);
      return saved;
    });
  } catch (err) {
    throw inaccessible(path, err);
  }
}

/** Where an update writes: the Home Config, or the file it links to, with that file's permissions. */
async function writeTarget(path: string): Promise<{ path: string; mode?: number }> {
  let link: boolean;
  try {
    link = (await io.lstat(path)).isSymbolicLink();
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return { path };
    throw err;
  }
  const target = link ? await linkTarget(path) : path;
  const stats = await io.stat(target);
  if (!stats.isFile()) throw unreadable(path, `${path} is not a file`, { path });
  return { path: target, mode: stats.mode & 0o7777 };
}

async function linkTarget(path: string): Promise<string> {
  try {
    return await io.realpath(path);
  } catch (err) {
    if (errorCode(err) === 'ENOENT') throw unreadable(path, `${path} links to a file that does not exist`, { path });
    throw err;
  }
}

const ACCESS_CODES = new Set(['EACCES', 'EPERM', 'EROFS', 'ENOENT', 'ENOTDIR']);

/**
 * A filesystem refusal (start-up creation ignores it, so this is where it surfaces) as a
 * `UsageError` naming the Home Config; any other error unchanged.
 */
function inaccessible(path: string, err: unknown): unknown {
  const code = errorCode(err);
  if (err instanceof RowblyError || !code || !ACCESS_CODES.has(code)) return err;
  return new UsageError(`cannot use the Home Config ${path}: ${(err as Error).message}`, {
    details: { path, errno: code },
    hint: `check that ${dirname(path)} exists and you may read and write it`,
    cause: err,
  });
}

function unreadable(path: string, message: string, details: Record<string, unknown>, cause?: unknown) {
  return new DataIntegrityError(message, {
    details,
    hint: `fix or move ${path}; Rowbly does not replace a Home Config it cannot read`,
    cause,
  });
}
