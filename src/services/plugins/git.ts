import { dirname } from 'node:path';
import { ConflictError, PluginError } from '../../core';
import type { DataRoot } from '../../schemas';
import { createRepositories, withLock } from '../../storage';
import {
  commitGitPaths,
  ensureGitQueueDir,
  gitInfo,
  pendingPath,
  readGitPending,
  writeGitPending,
} from '../../storage/git';
import { type GitSyncResult, syncGit } from '../../storage/gitSync';
import { coordinated, outsideCoordination } from '../coordination';
import { currentScope } from './executionScope';
import type { ChangeSetView, GitCommitOptions, PluginGit } from './types';

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const queues = new Map<string, { root: string; done: Promise<void> }>();
/** The running Sync per Git directory's Rowbly folder: a second Sync is refused, not queued. */
const syncs = new Set<string>();

/** Command mode waits for due work outside reaction deadlines; future interval timers stay unref'd. */
export async function drainGitQueue(root?: DataRoot): Promise<void> {
  while (true) {
    const running = [...queues.values()].filter((queue) => !root || queue.root === root.path);
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
): PluginGit {
  let location: Promise<string> | undefined;
  const filePath = () => (location ??= pendingPath(root, id));
  const warning = (err: unknown) => warn(`Git automation: ${err instanceof Error ? err.message : String(err)}`);

  /** Runs `job` after the queued Git work for `file`, under the cross-process Git lock. */
  function chain<T>(file: string, operation: string, job: () => Promise<T>): Promise<T> {
    const previous = queues.get(file)?.done ?? Promise.resolve();
    const result = previous.then(() =>
      outsideCoordination(() =>
        withLock(dirname(file), { operation: `${id}.${operation}`, subject: 'The Git queue' }, job),
      ),
    );
    const done = result.then(
      () => undefined,
      () => undefined,
    );
    queues.set(file, { root: root.path, done });
    void done.then(() => {
      if (queues.get(file)?.done === done) queues.delete(file);
    });
    return result;
  }

  function enqueue(file: string) {
    chain(file, 'git', () => work(file)).catch(warning);
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
      if (config.plugins?.[id]?.enabled !== true) return null;
      return readGitPending(file);
    });
    if (!pending) return false;
    if (pending.options.frequency === 'interval' && pending.due > Date.now()) {
      arm(file, pending.due);
      return false;
    }
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

  async function schedule(given?: GitCommitOptions, paths: string[] = []) {
    const file = await filePath();
    let due: number | undefined;
    await coordinated(root, `${id}.git`, async () => {
      clearTimeout(timers.get(file));
      timers.delete(file);
      const config = await createRepositories(root).rootConfig.get();
      if (config.plugins?.[id]?.enabled !== true) return;
      let pending = await readGitPending(file);
      const options = given ?? pending?.options;
      if (!options) return;
      if (paths.length) {
        pending = {
          paths: [...new Set([...(pending?.paths ?? []), ...paths])],
          due: pending?.due ?? Date.now() + options.intervalSeconds * 1000,
          options: pending?.options ?? options,
          revision: pending?.revision,
        };
      }
      if (!pending) return;
      pending.due += (options.intervalSeconds - pending.options.intervalSeconds) * 1000;
      pending.options = options;
      pending.revision = (pending.revision ?? 0) + 1;
      await writeGitPending(file, pending);
      due = options.frequency === 'change' ? 0 : pending.due;
    });
    if (due === undefined) return;
    if (due > Date.now()) arm(file, due);
    else enqueue(file);
  }
  function assertEffect() {
    const scope = currentScope();
    if (scope && (scope.stage !== 'reaction' || scope.ended)) {
      throw new PluginError('Git effects are available only at Plugin start or in a live reaction');
    }
  }
  /** Sync also runs from a screen, such as a TUI Action (ADR-0035). */
  function assertSync() {
    const scope = currentScope();
    if (scope && ((scope.stage !== 'reaction' && scope.stage !== 'screen') || scope.ended)) {
      throw new PluginError('Git Sync is available only at Plugin start, in a live reaction or from a screen');
    }
  }
  return {
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
    async sync(options): Promise<GitSyncResult> {
      assertSync();
      const file = await filePath();
      const key = dirname(file);
      // No await between the check and the add, so two calls cannot both pass.
      if (syncs.has(key)) throw new ConflictError('Sync is already running', { hint: 'wait for it to finish' });
      syncs.add(key);
      try {
        await ensureGitQueueDir(file);
        // Lock order: this guard, then the Git lock, then (briefly, for the snapshot) the Data Root lock.
        return await chain(file, 'git.sync', () =>
          syncGit(root, options, (read) => coordinated(root, `${id}.git.snapshot`, read)),
        );
      } finally {
        syncs.delete(key);
      }
    },
  };
}
