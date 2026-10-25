import { isDeepStrictEqual } from 'node:util';
import { PluginError } from '../../core';
import type { DataRoot } from '../../schemas';
import { createRepositories } from '../../storage';
import {
  commitGitPaths,
  type GitPending,
  gitInfo,
  pendingPath,
  readGitPending,
  writeGitPending,
} from '../../storage/git';
import { canonicalGitRoot, requireRepository, withGitWorker } from '../../storage/gitRepository';
import { coordinated, outsideCoordination } from '../coordination';
import { currentScope } from './executionScope';
import { createGitSync, disposeSyncOwner, drainSyncQueue } from './gitSync';
import type { AnyPluginDefinition, ChangeSetView, GitCommitOptions, GitOptionsSource, PluginGit } from './types';

const timerOwners = new Map<string, object>();
const disposedOwners = new WeakSet<object>();
export function disposeGitOwner(owner: object): void {
  disposedOwners.add(owner);
  disposeSyncOwner(owner);
  for (const [file, holder] of timerOwners)
    if (holder === owner) {
      clearTimeout(timers.get(file));
      timers.delete(file);
      timerOwners.delete(file);
    }
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const queues = new Map<string, { root: string; done: Promise<void> }>();

/** Command mode waits for due work outside reaction deadlines; future interval timers stay unref'd. */
export async function drainGitQueue(root?: DataRoot): Promise<void> {
  await drainSyncQueue(root);
  const path = root ? (await canonicalGitRoot(root)).path : undefined;
  while (true) {
    const running = [...queues.values()].filter((queue) => !path || queue.root === path);
    if (!running.length) return;
    await Promise.all(running.map((queue) => queue.done));
  }
}

/** Every saved Operation contributes only the paths it owns, never Local State or transaction files. */
function changedPaths(changes: ChangeSetView): string[] {
  const paths = new Set<string>();
  for (const change of changes.changes) {
    switch (change.type) {
      case 'rootConfig':
        paths.add('rowbly.config.json');
        break;
      case 'file':
        paths.add(change.path);
        break;
      case 'board':
        if (change.after) paths.add(`boards/${change.after.id}/board.config.json`);
        if (change.before && !change.after) paths.add(`boards/${change.before.id}`);
        break;
      case 'story':
        if (change.before)
          paths.add(change.beforeFolder ?? `boards/${change.before.boardId}/stories/${change.before.key}`);
        if (change.after) paths.add(`boards/${change.after.boardId}/stories/${change.after.key}`);
        break;
    }
  }
  return [...paths];
}

/** Persist short queue updates under the Data Root lock; Git work has a separate cross-process lock. */
export function createPluginGit(
  root: DataRoot,
  id: string,
  warn: (message: string) => void = (message) => process.stderr.write(`${message}\n`),
  registry: readonly AnyPluginDefinition[] = [],
  owner?: object,
): PluginGit {
  let location: Promise<string> | undefined;
  let queueRoot = root.path;
  let source: GitOptionsSource | undefined;
  const filePath = () =>
    (location ??= (async () => {
      const canonical = await canonicalGitRoot(root);
      queueRoot = canonical.path;
      return pendingPath(canonical, id);
    })());
  const warning = (err: unknown) => warn(`Git automation: ${err instanceof Error ? err.message : String(err)}`);

  // The resolver only interprets its own bag; the host owns the fresh read and its lock.
  async function options(fallback?: GitCommitOptions): Promise<GitCommitOptions | undefined> {
    return typeof source === 'function'
      ? source((await createRepositories(root).localState.get()).plugins?.[id])
      : fallback;
  }

  function updated(pending: GitPending, options: GitCommitOptions): GitPending {
    return {
      ...pending,
      due: pending.due + (options.intervalSeconds - pending.options.intervalSeconds) * 1000,
      options,
      revision: (pending.revision ?? 0) + 1,
    };
  }

  function cancelTimer(file: string) {
    clearTimeout(timers.get(file));
    timers.delete(file);
  }

  function enqueue(file: string) {
    const previous = queues.get(file)?.done ?? Promise.resolve();
    const done = previous
      .then(() => outsideCoordination(async () => withGitWorker(await requireRepository(root), () => work(file))))
      .catch(warning);
    queues.set(file, { root: queueRoot, done });
    void done.then(() => {
      if (queues.get(file)?.done === done) queues.delete(file);
    });
  }

  function arm(file: string, due: number) {
    clearTimeout(timers.get(file));
    const timer = setTimeout(
      () => {
        timers.delete(file);
        enqueue(file);
      },
      Math.min(Math.max(0, due - Date.now()), 2_147_483_647),
    );
    timer.unref();
    timers.set(file, timer);
  }

  async function work(file: string) {
    while (await commitPending(file)) {
      /* Edits enqueued by another process are drained here too. */
    }
  }

  async function commitPending(file: string): Promise<boolean> {
    const pending = await coordinated(root, `${id}.git.pending`, async () => {
      const config = await createRepositories(root).rootConfig.get();
      if (config.plugins?.[id]?.enabled !== true || (owner && disposedOwners.has(owner))) return null;
      let pending = await readGitPending(file);
      if (!pending) return null;
      const current = await options(pending.options);
      if (current && !isDeepStrictEqual(current, pending.options)) {
        pending = updated(pending, current);
        await writeGitPending(file, pending);
      }
      if (pending.options.automaticCommits === false) {
        cancelTimer(file);
        return null;
      }
      if (pending.options.frequency === 'interval' && pending.due > Date.now()) {
        arm(file, pending.due);
        return null;
      }
      return pending;
    });
    if (!pending) return false;
    await commitGitPaths(root, pending.paths, pending.options, (read) => coordinated(root, `${id}.git.snapshot`, read));
    return coordinated(root, `${id}.git.acknowledge`, async () => {
      const latest = await readGitPending(file);
      // An edit to the same path during a commit is still new work, even if the path list is equal.
      if (latest?.revision === pending.revision) {
        await writeGitPending(file, null);
        return false;
      }
      return true;
    });
  }

  async function schedule(given: GitOptionsSource, paths: string[] = []) {
    if (owner && disposedOwners.has(owner)) return;
    const file = await filePath();
    if (owner && disposedOwners.has(owner)) return;
    if (owner) timerOwners.set(file, owner);
    await coordinated(root, `${id}.git`, async () => {
      if (owner && disposedOwners.has(owner)) return;
      cancelTimer(file);
      const config = await createRepositories(root).rootConfig.get();
      if (config.plugins?.[id]?.enabled !== true) return;
      source = given;
      let pending = await readGitPending(file);
      const current = await options(typeof given === 'function' ? undefined : given);
      if (!current) return;
      if (paths.length) {
        pending = {
          paths: [...new Set([...(pending?.paths ?? []), ...paths])],
          due: pending?.due ?? Date.now() + current.intervalSeconds * 1000,
          options: pending?.options ?? current,
          revision: pending?.revision,
        };
      }
      if (!pending) return;
      pending = updated(pending, current);
      await writeGitPending(file, pending);
      if (current.automaticCommits === false) return;
      const due = current.frequency === 'change' ? 0 : pending.due;
      if (due > Date.now()) arm(file, due);
      else enqueue(file);
    });
  }
  function assertEffect() {
    const scope = currentScope();
    if (scope && (scope.stage !== 'reaction' || scope.ended)) {
      throw new PluginError('Git effects are available only at Plugin start or in a live reaction');
    }
  }
  return {
    ...createGitSync(root, id, registry, warn, owner),
    info: () => gitInfo(root),
    async resume(options) {
      assertEffect();
      try {
        await schedule(options);
      } catch (err) {
        warning(err);
      }
    },
    changed: (changes, options) => {
      assertEffect();
      return schedule(options, changedPaths(changes));
    },
  };
}
