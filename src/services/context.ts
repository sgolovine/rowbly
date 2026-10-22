import { isSlug, NotFoundError, UsageError, ValidationError } from '../core';
import type { LocalState, Slug } from '../schemas';
import type { Repositories } from '../storage';
import { applyGlobalMe, readGlobalMe } from './identity';
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
      if (handle !== null && !isSlug(handle)) {
        throw new ValidationError(`invalid handle "${handle}": must be a lower-kebab-case slug`);
      }
      // The latest global Me, so that clearing the local Me falls back to it (ADR-0032 §2). Me is
      // recomputed now too: the runtime only does so when the stored local Me changes, which
      // clearing a local Me that is already unset does not.
      if (ctx.home !== undefined) applyGlobalMe(ctx, await readGlobalMe(ctx.home));
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
