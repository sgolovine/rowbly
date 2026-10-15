import { NotFoundError, UsageError } from '../core';
import type { LocalState, Slug } from '../schemas';
import type { Repositories } from '../storage';
import type { CoreChangeSet } from './plugins/changeSet';
import type { OperationRunner } from './plugins/runtime';
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

  /** Saves Local State through `changes` and keeps `ctx.local` in step with it once the operation saves. */
  function save(changes: CoreChangeSet, update: (state: LocalState) => LocalState): Promise<LocalState> {
    // `ctx.local` is the Local State this run started from (and has changed since).
    return changes.updateLocalState(() => update(ctx.local));
  }

  return {
    resolveBoard,

    async use(board, opts = {}) {
      const boardId = (await repos.boards.get(board)).id;
      ctx.local = await ops.run('context.use', { board, ...opts }, (changes) =>
        save(changes, (state) => ({ ...state, board: boardId })),
      );
      return ctx.local;
    },

    async clearUse(opts = {}) {
      // The new Local State refreshes the context; the operation's result is `undefined` (ARCH-14).
      let next: LocalState | undefined;
      await ops.run('context.clearUse', { ...opts }, async (changes) => {
        next = await save(changes, ({ board: _b, ...rest }) => rest);
      });
      if (next) ctx.local = next;
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
      ctx.local = await ops.run('context.setMe', { handle, ...opts }, (changes) =>
        save(changes, ({ me: _me, ...rest }) => (handle === null ? rest : { ...rest, me: handle })),
      );
      ctx.me = handle;
      return ctx.local;
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
