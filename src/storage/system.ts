// Small filesystem and process helpers that the Command and TUI layers need but may not
// implement themselves, because only storage may import `node:fs`.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { NotFoundError, UsageError } from '../core';
import { io } from './io';

/** Reads a UTF-8 text file; a missing file is a `NotFoundError`. */
export async function readTextFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundError(`file not found: ${path}`);
    throw err;
  }
}

/** Whether anything (file or folder) exists at `path`. */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Writes a UTF-8 text file, creating its folder first. The text goes to a temporary file beside
 * the destination, which replaces it only once complete (`writeFileAtomic`), so a failed write
 * never truncates the original (RES-03).
 */
export async function writeTextFile(path: string, text: string): Promise<void> {
  await io.mkdir(dirname(path));
  await writeFileAtomic(path, text);
}

/**
 * Replaces `path` with `text` atomically (ADR-0019 §3): writes and fsyncs `.<name>.<8 hex>.tmp` in
 * the same folder, renames it over `path` and fsyncs the folder. On failure the temporary file is
 * removed, best effort, and the original error is rethrown; the destination keeps its old bytes.
 * The folder must exist. `mode` gives the new file those permissions, for example the old file's.
 */
export async function writeFileAtomic(path: string, text: string | Uint8Array, mode?: number): Promise<void> {
  const dir = dirname(path);
  const temp = join(dir, `.${basename(path)}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    await io.writeFile(temp, text, 'wx', mode);
    await io.rename(temp, path);
  } catch (err) {
    try {
      await io.rm(temp);
    } catch {
      // Cleanup is best effort; the original error is the one that matters.
    }
    throw err;
  }
  await io.syncDir(dir);
}

/**
 * Writes `initial` to a temp file, opens `$VISUAL`/`$EDITOR` (fallback `vi`) on it with the
 * terminal attached, and returns the saved text. A non-zero editor exit is a `UsageError`.
 */
export async function editTextInEditor(initial: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const editor = env.VISUAL || env.EDITOR || 'vi';
  const dir = await mkdtemp(join(tmpdir(), 'rowbly-edit-'));
  const file = join(dir, 'ROWBLY_EDIT.md');
  try {
    await writeFile(file, initial, 'utf8');
    // Run through the shell so EDITOR may carry arguments (e.g. "code --wait").
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(`${editor} "$ROWBLY_EDIT_FILE"`, {
        shell: true,
        stdio: 'inherit',
        env: { ...env, ROWBLY_EDIT_FILE: file },
      });
      child.on('error', reject);
      child.on('exit', resolve);
    });
    if (code !== 0) throw new UsageError(`editor "${editor}" exited with code ${code}`);
    return await readFile(file, 'utf8');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
