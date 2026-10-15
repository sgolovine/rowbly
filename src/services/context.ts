import { NotFoundError, UsageError } from '../core';
import type { LocalState, Slug } from '../schemas';
import type { Repositories } from '../storage';
import type { CoreChangeSet } from './plugins/changeSet';
import { latestLocalState, type OperationRunner } from './plugins/runtime';
import type { ContextService, RowblyContext } from './types';

export function createContextService(ctx: RowblyContext, repos: Repositories, ops: OperationRunner): ContextService {
  /** `flag` (callers pass `--board ?? ROWBLY_BOARD`) → Local State → the only Board. */
  async function resolveBoard(flag?: string): Promise<Slug> {
    if (flag) return (await repos.boards.get(flag)).id;
    const stored = ctx.local.board;
    // A stale Local State Board (deleted since) is skipped; `doctor` reports it.
    if (stored && (await exists(repos.boards.get(stored)))) return stored;
    const all = await repos.boards.list();
    if (all.length === 1 && all[0]) return all[0].id;
    if (all.length === 0) {
      throw new UsageError('board required: no Boards exist', {
        hint: 'run `rowbly boards create <id> --name <name> --prefix <PREFIX>`',
      });
    }
    throw new UsageError('board required', { hint: 'pass --board <id> or run `rowbly use <board>`' });
  }

  /**
   * Changes the latest Local State: the pending one, else the stored one, read under the lock, never
   * the context's copy (ARCH-37). The runner copies the saved Local State into the context.
   */
  function save(changes: CoreChangeSet, update: (state: LocalState) => LocalState): Promise<LocalState> {
    return changes.updateLocalState(update);
  }

  return {
    resolveBoard,

    async use(board, opts = {}) {
      const boardId = (await repos.boards.get(board)).id;
      return ops.run(
        'context.use',
        { board, ...opts },
        (changes) => save(changes, (state) => ({ ...state, board: boardId })),
        latestLocalState,
      );
    },

    async clearUse(opts = {}) {
      // The operation's result is `undefined` (ARCH-14); the runner refreshes the context.
      await ops.run('context.clearUse', { ...opts }, async (changes) => {
        await save(changes, ({ board: _b, ...rest }) => rest);
      });
    },

    async setMe(handle, opts = {}) {
      if (handle !== null) {
        const { assignees } = await repos.rootConfig.get();
        if (!assignees.some((a) => a.handle === handle)) {
          throw new NotFoundError(`Assignee "${handle}" not found`, {
            hint: 'run `rowbly assignees add <handle> --name <name>`',
          });
        }
      }
      return ops.run(
        'context.setMe',
        { handle, ...opts },
        (changes) => save(changes, ({ me: _me, ...rest }) => (handle === null ? rest : { ...rest, me: handle })),
        latestLocalState,
      );
    },
  };
}

async function exists(promise: Promise<unknown>): Promise<boolean> {
  try {
    await promise;
    return true;
  } catch (err) {
    if (err instanceof NotFoundError) return false;
    throw err;
  }
}
