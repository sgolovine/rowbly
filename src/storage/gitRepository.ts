import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import type { DataRoot } from '../schemas';
import { gitText } from './gitProcess';
import { io } from './io';
import { type LockHandle, withLock } from './lock';
import { canonicalDataRoot } from './pathPolicy';

export interface GitRepository {
  top: string;
  gitDir: string;
  common: string;
  worker: string;
  gate: string;
  journal: string;
  index: string;
}
const locations = new Map<string, Promise<GitRepository | null>>();
const workers = new AsyncLocalStorage<ReadonlyMap<string, LockHandle>>();
/** Private Git paths use the physical Data Root; discovery and display keep the supplied path. */
export async function canonicalGitRoot(root: DataRoot): Promise<DataRoot> {
  return { ...root, path: await canonicalDataRoot(root.path) };
}
/** Resolve before taking a Data Root lock. A missing Git repository is not cached. */
export async function repositoryFor(root: DataRoot): Promise<GitRepository | null> {
  root = await canonicalGitRoot(root);
  let found = locations.get(root.path);
  if (!found) {
    found = (async () => {
      const query = await gitText(
        root.path,
        ['rev-parse', '--path-format=absolute', '--show-toplevel', '--absolute-git-dir', '--git-common-dir'],
        { allowFailure: true },
      );
      const [top, gitDir, common] = query.split('\n');
      if (!top || !gitDir || !common) return null;
      const canonical = await io.realpath(common);
      const worktree = await io.realpath(gitDir);
      return {
        top: await io.realpath(top),
        gitDir: worktree,
        common: canonical,
        worker: join(canonical, 'rowbly', 'worker'),
        gate: join(canonical, 'rowbly', 'publication'),
        journal: join(canonical, 'rowbly', 'publication.json'),
        index: join(worktree, 'index'),
      };
    })();
    locations.set(root.path, found);
    void found.then(
      (repo) => {
        if (!repo) locations.delete(root.path);
      },
      () => locations.delete(root.path),
    );
  }
  return found;
}
export async function requireRepository(root: DataRoot): Promise<GitRepository> {
  const repo = await repositoryFor(root);
  if (!repo) throw new Error('Git synchronization requires a Git repository');
  return repo;
}
/** One common-repository worker; reentrancy is explicit in its async context, never pid-based. */
export async function withGitWorker<T>(repo: GitRepository, fn: () => Promise<T>): Promise<T> {
  const held = workers.getStore()?.get(repo.common);
  if (held && !held.released) return fn();
  await io.mkdir(repo.worker);
  return withLock(repo.worker, { operation: 'git.worker', subject: 'Git automation' }, async (lock) => {
    const map = new Map(workers.getStore());
    map.set(repo.common, lock);
    return workers.run(map, fn);
  });
}
/** `root` is bound by canonicalGitRoot before choosing persisted or runtime identity. */
export function rootGitKey(root: DataRoot): string {
  return createHash('sha256').update(root.path).digest('hex').slice(0, 20);
}
/** Both repository and Data Root paths are canonical before calculating containment. */
export function rootPrefix(repo: GitRepository, root: DataRoot): string {
  const path = relative(repo.top, root.path).split('\\').join('/');
  if (path === '..' || path.startsWith('../')) throw new Error('Data Root is outside the Git working tree');
  return path;
}
export function repositoryPath(repo: GitRepository, path: string): string {
  if (
    !path ||
    path.split('/').some((p) => !p || p === '.' || p === '..' || p === '.git') ||
    resolve(repo.top, path) !== join(repo.top, path)
  )
    throw new Error(`Unsafe publication path: ${path}`);
  return join(repo.top, path);
}

export function assertGitWorker(repo: GitRepository): void {
  const held = workers.getStore()?.get(repo.common);
  if (!held || held.released) throw new Error('Git publication requires its shared worker lock');
}
