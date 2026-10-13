// Small filesystem and process helpers that the Command and TUI layers need but may not
// implement themselves, because only storage may import `node:fs`.
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { NotFoundError, UsageError } from '../core';

/** Reads a UTF-8 text file; a missing file is a `NotFoundError`. */
export async function readTextFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundError(`file not found: ${path}`);
    throw err;
  }
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

/** `git config user.email`, or `null` when git or the setting is missing. */
export async function gitUserEmail(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await promisify(execFile)('git', ['config', 'user.email'], { cwd });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
