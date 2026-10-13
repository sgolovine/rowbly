import { NotFoundError, UsageError } from '../core';
import type { LocalState, Slug } from '../schemas';
import type { Repositories } from '../storage';
import type { ContextService, RowblyContext } from './types';

export function createContextService(ctx: RowblyContext, repos: Repositories): ContextService {
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

  async function save(next: LocalState): Promise<LocalState> {
    await repos.localState.put(next);
    ctx.local = next;
    return next;
  }

  return {
    resolveBoard,

    async use(board) {
      const boardId = (await repos.boards.get(board)).id;
      return save({ ...ctx.local, board: boardId });
    },

    async clearUse() {
      const { board: _b, ...rest } = ctx.local;
      await save(rest);
    },

    async setMe(handle) {
      const { me: _me, ...rest } = ctx.local;
      if (handle === null) {
        ctx.me = null;
        return save(rest);
      }
      const { assignees } = await repos.rootConfig.get();
      if (!assignees.some((a) => a.handle === handle)) {
        throw new NotFoundError(`Assignee "${handle}" not found`, {
          hint: 'run `rowbly assignees add <handle> --name <name>`',
        });
      }
      ctx.me = handle;
      return save({ ...rest, me: handle });
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
