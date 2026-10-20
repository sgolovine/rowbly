import { PluginError } from '../../core';
import type { DataRoot } from '../../schemas';
import { createRepositories } from '../../storage';
import { commitGitPaths, gitInfo, pendingPath, readGitPending, writeGitPending } from '../../storage/git';
import { coordinated } from '../coordination';
import { currentScope } from './executionScope';
import type { ChangeSetView, GitCommitOptions, PluginGit } from './types';

const timers = new Map<string, ReturnType<typeof setTimeout>>();

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

/** All metadata changes and Git effects coordinate with Rowbly writes, including across processes. */
export function createPluginGit(
  root: DataRoot,
  id: string,
  warn: (message: string) => void = (message) => process.stderr.write(`${message}\n`),
): PluginGit {
  async function schedule(given?: GitCommitOptions, paths: string[] = []) {
    await coordinated(root, `${id}.git`, async () => {
      const file = await pendingPath(root, id);
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
        };
      }
      if (!pending) return;
      pending.due += (options.intervalSeconds - pending.options.intervalSeconds) * 1000;
      pending.options = options;
      await writeGitPending(file, pending);
      if (options.frequency === 'change' || pending.due <= Date.now()) {
        await commitGitPaths(root, pending.paths, options);
        await writeGitPending(file, null);
      } else {
        const timer = setTimeout(
          () => {
            timers.delete(file);
            void schedule().catch((err: unknown) =>
              warn(`Git automation: ${err instanceof Error ? err.message : String(err)}`),
            );
          },
          Math.min(pending.due - Date.now(), 2_147_483_647),
        );
        timer.unref();
        timers.set(file, timer);
      }
    });
  }
  function assertEffect() {
    const scope = currentScope();
    if (scope && (scope.stage !== 'reaction' || scope.ended)) {
      throw new PluginError('Git effects are available only at Plugin start or in a live reaction');
    }
  }
  return {
    info: () => gitInfo(root),
    async resume(options) {
      assertEffect();
      try {
        await schedule(options);
      } catch (err) {
        warn(`Git automation: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    changed: (changes, options) => {
      assertEffect();
      return schedule(options, changedPaths(changes));
    },
  };
}
