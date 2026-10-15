// Plain file access for Plugin files and for saving Change Sets.
import { randomBytes } from 'node:crypto';
import type { Stats } from 'node:fs';
import { readdir, readFile, rm, rmdir } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { ConflictError, DataIntegrityError } from '../core';
import { entryExists, errorCode, io } from './io';

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

export interface FolderMove {
  from: string;
  to: string;
}

/**
 * Checks a complete set of folder moves before anything moves (RES-04): every source is an existing
 * folder, no two moves share a source or a destination, no move goes into a folder that moves, and
 * every destination is free unless it is itself a source moving away in the same set, or is listed
 * in `vacated` (for example a folder the same plan deletes first). Throws `ConflictError`.
 */
export async function preflightMoves(moves: readonly FolderMove[], vacated: readonly string[] = []): Promise<void> {
  const sources = new Set<string>();
  const destinations = new Set<string>();
  for (const { from, to } of moves) {
    if (sources.has(from)) throw new ConflictError(`${from} is moved twice`, { details: { path: from } });
    if (destinations.has(to)) throw new ConflictError(`two folders are moved to ${to}`, { details: { path: to } });
    sources.add(from);
    destinations.add(to);
  }
  const free = new Set([...sources, ...vacated]);
  for (const { from, to } of moves) {
    for (const other of [...sources, ...destinations]) {
      if (other !== from && isInside(other, from)) {
        throw new ConflictError(`${other} lies inside ${from}, which moves`, { details: { path: other } });
      }
      if (other !== to && isInside(other, to)) {
        throw new ConflictError(`${other} lies inside ${to}, which is a move destination`, {
          details: { path: other },
        });
      }
    }
    let source: Stats;
    try {
      source = await io.lstat(from);
    } catch (err) {
      if (errorCode(err) !== 'ENOENT') throw err;
      throw new ConflictError(`cannot move ${from}: it does not exist`, { details: { path: from } });
    }
    if (!source.isDirectory()) {
      throw new ConflictError(`cannot move ${from}: it is not a folder`, { details: { path: from } });
    }
    if (from !== to && !free.has(to) && (await entryExists(to))) {
      throw new ConflictError(`cannot move ${from} to ${to}: the destination is already taken`, {
        details: { path: to, from },
        hint: 'run `rowbly doctor` to see what occupies it',
      });
    }
  }
}

/**
 * Moves folders, through temporary names first, so that one folder may move to where another one
 * is moving away from. The whole set is checked first (`preflightMoves`), so an occupied
 * destination fails before any source moves. If a rename fails, the folders already moved are put
 * back, so no hidden `.moving` folder is left behind by a handled error.
 */
export async function moveFolders(moves: readonly FolderMove[]): Promise<void> {
  const active = moves.filter(({ from, to }) => from !== to);
  await preflightMoves(active);
  const staged: { from: string; temp: string; to: string; placed: boolean }[] = [];
  try {
    for (const { from, to } of active) {
      const temp = join(dirname(from), `.${randomBytes(4).toString('hex')}.moving`);
      await io.rename(from, temp);
      staged.push({ from, temp, to, placed: false });
    }
    for (const move of staged) {
      await io.mkdir(dirname(move.to));
      await io.rename(move.temp, move.to);
      move.placed = true;
    }
  } catch (err) {
    const unrestored = await putBack(staged);
    if (unrestored.length === 0) throw err;
    throw new DataIntegrityError('folders were moved only in part, and putting them back failed', {
      details: { paths: unrestored },
      hint: 'move each listed folder back to its Story Key by hand, then run `rowbly doctor`',
      cause: err,
    });
  }
}

/** Undoes a partial `moveFolders`, newest first. Returns the paths it could not put back. */
async function putBack(staged: { from: string; temp: string; to: string; placed: boolean }[]): Promise<string[]> {
  const failures: string[] = [];
  for (const move of [...staged].reverse()) {
    try {
      if (move.placed) await io.rename(move.to, move.temp);
      move.placed = false;
    } catch {
      failures.push(move.to);
    }
  }
  for (const move of [...staged].reverse()) {
    if (move.placed) continue;
    try {
      await io.rename(move.temp, move.from);
    } catch {
      failures.push(move.temp);
    }
  }
  return failures;
}

/** Whether `path` is strictly inside folder `dir`. */
function isInside(path: string, dir: string): boolean {
  return path.startsWith(dir.endsWith(sep) ? dir : `${dir}${sep}`);
}
