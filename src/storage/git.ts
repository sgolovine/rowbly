import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { ValidationError } from '../core';
import type { DataRoot } from '../schemas';
import { readTextIfExists } from './files';
import { errorCode, io } from './io';
import { writeTextFile } from './system';
import { isWatchedPath } from './watch';

const execute = promisify(execFile);

/** No shell, bounded output/time, and no inherited Git directory/index/author overrides. */
export async function runGit(
  cwd: string,
  args: readonly string[],
  options: { timeout?: number; env?: Record<string, string> } = {},
): Promise<string> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const { stdout } = await execute('git', [...args], {
    cwd,
    env: { ...env, GIT_TERMINAL_PROMPT: '0', ROWBLY_GIT_AUTOCOMMIT: '1', ...options.env },
    timeout: options.timeout ?? 3500,
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}

export async function gitInfo(root: DataRoot) {
  const path = await io.realpath(root.path);
  let top: string;
  try {
    top = (await runGit(path, ['rev-parse', '--show-toplevel'])).trim();
  } catch {
    throw new ValidationError('Git automation requires the Data Root to be inside a Git repository', {
      hint: 'initialize Git in the folder containing the Data Root, or disable the Git Plugin',
    });
  }
  const config = async (key: string) => {
    try {
      return (await runGit(top, ['config', '--get', key])).trim();
    } catch {
      return '';
    }
  };
  return { root: top, authorName: await config('user.name'), authorEmail: await config('user.email') };
}

/**
 * Whether `inside`, a Data Root path with `/`, is Rowbly data that Git automation commits: anything
 * but Local State (`local.json`), the Data Root lock (`.lock`, `.lock.break`), the commit journal
 * (`.txn/`) and atomic-write temporary files (`.<name>.<8 hex>.tmp`). Other dot files, such as the
 * Data Root's `.gitignore`, are committed.
 */
export function isCommittedPath(inside: string): boolean {
  return inside !== 'local.json' && isWatchedPath(inside);
}

/**
 * Whether Sync's scan of `git status` commits `inside`: a committed path (`isCommittedPath`) with no
 * dot-named segment, so editor and system files (`.DS_Store`, `.story.json.swp`) are never pushed.
 * The Data Root's own `.gitignore` is the one dot file it commits. A Plugin's dot-named file is still
 * committed by the Automatic Commit of the Operation that writes it.
 */
export function isSyncedPath(inside: string): boolean {
  if (inside === '.gitignore') return true;
  return isCommittedPath(inside) && !inside.split('/').some((part) => part.startsWith('.'));
}

/** Personal Git commit preferences; omitted author fields use Git configuration. */
export interface GitCommitOptions {
  frequency: 'change' | 'interval';
  intervalSeconds: number;
  authorName?: string;
  authorEmail?: string;
}

export interface GitPending {
  paths: string[];
  due: number;
  options: GitCommitOptions;
  /** Older pending files omit this; every new enqueue increments it. */
  revision?: number;
}

export async function pendingPath(root: DataRoot, plugin: string): Promise<string> {
  const path = await io.realpath(root.path);
  const dir = (await runGit(path, ['rev-parse', '--absolute-git-dir'])).trim();
  const key = createHash('sha256').update(path).digest('hex').slice(0, 20);
  return join(dir, 'rowbly', `${plugin}-${key}.json`);
}

/** Creates the folder of `file` in Git's directory, where the Git lock lives; a fresh clone has none yet. */
export async function ensureGitQueueDir(file: string): Promise<void> {
  await io.mkdir(dirname(file));
}

export async function readGitPending(path: string): Promise<GitPending | null> {
  const text = await readTextIfExists(path);
  if (text === null) return null;
  const value: unknown = JSON.parse(text);
  if (
    !value ||
    typeof value !== 'object' ||
    !('paths' in value) ||
    !Array.isArray(value.paths) ||
    !value.paths.every((p: unknown) => typeof p === 'string') ||
    !('due' in value) ||
    typeof value.due !== 'number' ||
    !Number.isFinite(value.due) ||
    ('revision' in value && (!Number.isSafeInteger(value.revision) || Number(value.revision) < 1)) ||
    !('options' in value) ||
    !value.options ||
    typeof value.options !== 'object' ||
    !('frequency' in value.options) ||
    !['change', 'interval'].includes(String(value.options.frequency)) ||
    !('intervalSeconds' in value.options) ||
    typeof value.options.intervalSeconds !== 'number' ||
    !Number.isInteger(value.options.intervalSeconds) ||
    value.options.intervalSeconds < 1 ||
    value.options.intervalSeconds > 86400
  )
    throw new Error('Invalid pending Git automation data');
  return value as GitPending;
}

export async function writeGitPending(path: string, value: GitPending | null) {
  if (value) await writeTextFile(path, JSON.stringify(value));
  else await io.rm(path);
}

/** Commit only requested paths; unrelated staged files stay staged. Hooks are suppressed to prevent loops. */
export async function commitGitPaths(
  root: DataRoot,
  paths: string[],
  author: { authorName?: string; authorEmail?: string },
  snapshot: <T>(read: () => Promise<T>) => Promise<T>,
) {
  const info = await gitInfo(root);
  const data = await io.realpath(root.path);
  const prefix = relative(info.root, data).split('\\').join('/');
  const safe = paths.map((path) => {
    if (isAbsolute(path) || path.split('/').includes('..') || !isCommittedPath(path))
      throw new Error(`Unsafe Git automation path: ${path}`);
    const full = resolve(data, path);
    if (relative(data, full).startsWith('..')) throw new Error('Git automation path escapes the Data Root');
    return prefix ? `${prefix}/${path}` : path;
  });
  if (!safe.length) return;
  const specs = safe.map((path) => `:(literal)${path}`);
  const staged = await runGit(info.root, ['diff', '--cached', '--name-only', '-z', '--', ...specs]);
  if (staged)
    throw new Error(
      'Git automation cannot commit files that already have staged changes; commit or unstage those files first',
    );
  // Ignore paths which disappeared before ever being tracked, and paths ignored by Git.
  const tracked = (
    await runGit(info.root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...specs])
  )
    .split('\0')
    .filter(Boolean);
  if (!tracked.length) return;
  const files = [...new Set(tracked)].filter((path) => {
    const inside = prefix ? path.slice(prefix.length + 1) : path;
    return isCommittedPath(inside);
  });
  if (!files.length) return;
  const selected = files.map((path) => `:(literal)${path}`);
  const name = author.authorName || info.authorName;
  const email = author.authorEmail || info.authorEmail;
  if (!name || !email)
    throw new Error('Git automation needs an author name and email; configure Git or the Git Plugin');
  const queue = dirname(await pendingPath(root, 'git'));
  const hooks = join(queue, 'disabled-hooks');
  await io.mkdir(hooks);
  const tree = await mkdtemp(join(queue, 'snapshot-'));
  try {
    // Only file copies hold the Data Root lock. Every Git process reads this immutable snapshot.
    await snapshot(async () => {
      for (const file of files) {
        const source = join(info.root, file);
        const target = join(tree, file);
        try {
          if ((await io.lstat(source)).isSymbolicLink()) throw new Error(`Unsafe Git automation link: ${file}`);
          await io.mkdir(dirname(target));
          await copyFile(source, target);
        } catch (err) {
          if (errorCode(err) !== 'ENOENT') throw err; // Missing tracked files are deletions.
        }
      }
    });
    const git = (args: string[]) => runGit(tree, ['--git-dir', dirname(queue), '--work-tree', tree, ...args]);
    const dirty = await git(['status', '--porcelain', '--untracked-files=all', '--', ...selected]);
    if (!dirty) return;
    // Intent-to-add makes new files eligible for --only without staging their contents.
    try {
      await git(['add', '--intent-to-add', '--', ...selected]);
      await git([
        '-c',
        `core.hooksPath=${hooks}`,
        '-c',
        'commit.gpgSign=false',
        '-c',
        `user.name=${name}`,
        '-c',
        `user.email=${email}`,
        'commit',
        '--only',
        '--author',
        `${name} <${email}>`,
        '-m',
        'chore: update Rowbly data',
        '--',
        ...selected,
      ]);
    } catch (err) {
      // These paths had no staged content before our intent-to-add. Restore it on failure.
      await git(['reset', '--quiet', '--', ...selected]).catch(() => undefined);
      throw err;
    }
  } finally {
    await io.rm(tree);
  }
}
