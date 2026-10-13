import { NotFoundError, UsageError } from '../core';
import type { BoardRef, LocalState } from '../schemas';
import type { Repositories } from '../storage';
import type { ContextService, RowblyContext } from './types';

export function createContextService(ctx: RowblyContext, repos: Repositories): ContextService {
  /** `flag` (callers pass `--workspace ?? ROWBLY_WORKSPACE`) → Local State → the only Workspace. */
  async function resolveWorkspace(flag?: string) {
    if (flag) return (await repos.workspaces.get(flag)).id;
    const stored = ctx.local.workspace;
    // A stale Local State Workspace (deleted since) is skipped; `doctor` reports it.
    if (stored && (await exists(repos.workspaces.get(stored)))) return stored;
    const all = await repos.workspaces.list();
    if (all.length === 1 && all[0]) return all[0].id;
    if (all.length === 0) {
      throw new UsageError('workspace required: no Workspaces exist', {
        hint: 'run `rowbly workspaces create <id> --name <name>`',
      });
    }
    throw new UsageError('workspace required', { hint: 'pass --workspace <id> or run `rowbly use <workspace>`' });
  }

  /** `flag` (`--board ?? ROWBLY_BOARD`, may be `ws/board`) → Local State (same Workspace only) → the only Board. */
  async function resolveBoard(flag?: string): Promise<BoardRef> {
    if (flag) {
      const slash = flag.indexOf('/');
      const workspaceId = slash === -1 ? await resolveWorkspace() : flag.slice(0, slash);
      const boardId = slash === -1 ? flag : flag.slice(slash + 1);
      const board = await repos.boards.get({ workspaceId, boardId });
      return { workspaceId: board.workspaceId, boardId: board.id };
    }
    const workspaceId = await resolveWorkspace();
    const stored = ctx.local.board;
    if (stored && ctx.local.workspace === workspaceId) {
      const ref = { workspaceId, boardId: stored };
      if (await exists(repos.boards.get(ref))) return ref;
    }
    const all = await repos.boards.list(workspaceId);
    if (all.length === 1 && all[0]) return { workspaceId, boardId: all[0].id };
    if (all.length === 0) {
      throw new UsageError(`board required: Workspace "${workspaceId}" has no Boards`, {
        hint: 'run `rowbly boards create <id> --name <name> --prefix <PREFIX>`',
      });
    }
    throw new UsageError('board required', { hint: 'pass --board <id> or run `rowbly use <workspace>/<board>`' });
  }

  async function save(next: LocalState): Promise<LocalState> {
    await repos.localState.put(next);
    ctx.local = next;
    return next;
  }

  return {
    resolveWorkspace,
    resolveBoard,

    async use(ws, board) {
      const workspaceId = ws ? (await repos.workspaces.get(ws)).id : await resolveWorkspace();
      if (board) await repos.boards.get({ workspaceId, boardId: board });
      const { workspace: _w, board: _b, ...rest } = ctx.local;
      return save({ ...rest, workspace: workspaceId, ...(board ? { board } : {}) });
    },

    async clearUse() {
      const { workspace: _w, board: _b, ...rest } = ctx.local;
      await save(rest);
    },

    async setMe(handle) {
      const { me: _me, ...rest } = ctx.local;
      if (handle === null) {
        ctx.me = null;
        return save(rest);
      }
      const workspace = await repos.workspaces.get(await resolveWorkspace());
      if (!workspace.assignees.some((a) => a.handle === handle)) {
        throw new NotFoundError(`Assignee "${handle}" not found in Workspace "${workspace.id}"`, {
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
