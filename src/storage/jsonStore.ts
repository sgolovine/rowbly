import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { ZodType } from 'zod';
import { DataIntegrityError, NotFoundError, ValidationError } from '../core';

/** A line starting with a git conflict marker. */
export const CONFLICT_MARKER_RE = /^<{7}(?: |$)/m;

/**
 * ENOENT → `NotFoundError`; conflict markers → `DataIntegrityError` with `details.conflict`;
 * bad JSON or schema failure → `DataIntegrityError` with `details.path` (and `details.issues`).
 */
export async function readJson<T>(path: string, schema: ZodType<T>): Promise<T> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if (isEnoent(err)) throw new NotFoundError(`file not found: ${path}`, { details: { path } });
    throw err;
  }
  if (CONFLICT_MARKER_RE.test(text)) {
    throw new DataIntegrityError(`${path} contains git conflict markers`, {
      details: { path, conflict: true },
      hint: 'resolve the merge conflict in this file',
    });
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new DataIntegrityError(`${path} is not valid JSON`, { details: { path }, cause: err });
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new DataIntegrityError(`${path} does not match its schema`, {
      details: { path, issues: result.error.issues },
      hint: 'run `rowbly doctor`',
    });
  }
  return result.data;
}

/**
 * Validate → mkdir -p → write a temp file in the same directory → rename over the target.
 * The parsed value is serialized, so keys follow schema order; 2-space indent, trailing newline.
 */
export async function writeJson<T>(path: string, schema: ZodType<T>, value: T): Promise<void> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(`invalid data for ${path}`, { details: { path, issues: result.error.issues } });
  }
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const temp = join(dir, `.${basename(path)}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    await writeFile(temp, `${JSON.stringify(result.data, null, 2)}\n`, 'utf8');
    await rename(temp, path);
  } catch (err) {
    await rm(temp, { force: true });
    throw err;
  }
}

/** Entry names in `dir` of the given kind; a missing directory has none. */
export async function listEntries(dir: string, kind: 'file' | 'directory'): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => (kind === 'file' ? entry.isFile() : entry.isDirectory()))
      .map((entry) => entry.name)
      .sort();
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }
}

/** Removes a file or a folder recursively; a missing target is a `NotFoundError`. */
export async function remove(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true });
  } catch (err) {
    if (isEnoent(err)) throw new NotFoundError(`file not found: ${path}`, { details: { path } });
    throw err;
  }
}

function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}
