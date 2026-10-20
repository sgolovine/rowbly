import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { ValidationError } from '../core';
import type { DataRoot } from '../schemas';
import { readTextIfExists } from './files';
import { io } from './io';
import { writeTextFile } from './system';

const execute = promisify(execFile);

/** No shell, bounded output/time, and no inherited Git directory/index/author overrides. */
export async function runGit(cwd: string, args: readonly string[]): Promise<string> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const { stdout } = await execute('git', [...args], {
    cwd,
    env: { ...env, GIT_TERMINAL_PROMPT: '0', ROWBLY_GIT_AUTOCOMMIT: '1' },
    timeout: 3500,
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

export interface GitPending {
  paths: string[];
  due: number;
}

export async function pendingPath(root: DataRoot, plugin: string): Promise<string> {
  const path = await io.realpath(root.path);
  const dir = (await runGit(path, ['rev-parse', '--absolute-git-dir'])).trim();
  const key = createHash('sha256').update(path).digest('hex').slice(0, 20);
  return join(dir, 'rowbly', `${plugin}-${key}.json`);
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
    !Number.isFinite(value.due)
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
) {
  const info = await gitInfo(root);
  const data = await io.realpath(root.path);
  const prefix = relative(info.root, data).split('\\').join('/');
  const safe = paths.map((path) => {
    if (
      isAbsolute(path) ||
      path.split('/').includes('..') ||
      path.split('/').some((p) => p.startsWith('.')) ||
      path === 'local.json'
    )
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
  const selected = [...new Set(tracked)].map((path) => `:(literal)${path}`);
  const dirty = await runGit(info.root, ['status', '--porcelain', '--untracked-files=all', '--', ...selected]);
  if (!dirty) return;
  const name = author.authorName || info.authorName;
  const email = author.authorEmail || info.authorEmail;
  if (!name || !email)
    throw new Error('Git automation needs an author name and email; configure Git or the Git Plugin');
  // Intent-to-add makes new files eligible for --only without staging their contents.
  await runGit(info.root, ['add', '--intent-to-add', '--', ...selected]);
  const hooks = join(dirname(await pendingPath(root, 'git')), 'disabled-hooks');
  await io.mkdir(hooks);
  await runGit(info.root, [
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
}
