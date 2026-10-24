import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import type { DataRoot } from '../schemas';
import { gitText } from './gitProcess';
import { io } from './io';
import { type LockHandle, withLock } from './lock';

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
/** Resolve before taking a Data Root lock. A missing Git repository is not cached. */
export function repositoryFor(root: DataRoot): Promise<GitRepository | null> {
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
      return {
        top: await io.realpath(top),
        gitDir,
        common: canonical,
        worker: join(canonical, 'rowbly', 'worker'),
        gate: join(canonical, 'rowbly', 'publication'),
        journal: join(canonical, 'rowbly', 'publication.json'),
        index: join(gitDir, 'index'),
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
export function rootGitKey(root: DataRoot): string {
  return createHash('sha256').update(root.path).digest('hex').slice(0, 20);
}
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
