import { ConflictError, NotFoundError, toTimestamp, ValidationError } from '../core';
import { type BoardConfig, BoardConfigSchema, type BoardRef } from '../schemas';
import { createRepositories, type Repositories } from '../storage';
import type { BoardsService, RowblyContext } from './types';

export function createBoardsService(ctx: RowblyContext, repos: Repositories): BoardsService {
  return {
    async list(ws) {
      await repos.workspaces.get(ws);
      return repos.boards.list(ws);
    },

    get: (ref) => repos.boards.get(ref),

    async create(ws, input) {
      await repos.workspaces.get(ws);
      const now = toTimestamp(ctx.now());
      const board = parseBoard({
        version: 1,
        id: input.id,
        workspaceId: ws,
        name: input.name,
        description: input.description ?? '',
        keyPrefix: input.keyPrefix.toUpperCase(),
        createdAt: now,
        updatedAt: now,
      });
      if (await exists({ workspaceId: ws, boardId: board.id })) {
        throw new ConflictError(`Board "${ws}/${board.id}" already exists`);
      }
      const holder = await repos.boards.findByPrefix(board.keyPrefix);
      if (holder) {
        throw new ConflictError(
          `key prefix "${board.keyPrefix}" is already used by Board "${holder.workspaceId}/${holder.id}"`,
          { hint: 'key prefixes are unique across the Data Root; choose another --prefix' },
        );
      }
      // Stages and Custom Fields are inherited until a level is edited (copy-on-write).
      await repos.boards.put(board);
      return board;
    },

    async update(ref, patch) {
      const board = await repos.boards.get(ref);
      const next = parseBoard({
        ...board,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        updatedAt: toTimestamp(ctx.now()),
      });
      await repos.boards.put(next);
      return next;
    },

    async remove(ref, { force }) {
      const board = await repos.boards.get(ref);
      if (!force) {
        const stories = await repos.stories.allInBoard(ref);
        if (stories.length > 0) {
          throw new ConflictError(`Board "${ref.workspaceId}/${board.id}" has ${stories.length} Stories`, {
            details: { stories: stories.length },
            hint: 'pass --force to delete it with all its Stories',
          });
        }
      }
      await repos.boards.delete(ref);
      if (ctx.local.workspace === ref.workspaceId && ctx.local.board === ref.boardId) {
        const { board: _current, ...rest } = ctx.local;
        await repos.localState.put(rest);
        ctx.local = rest;
      }
    },
  };

  async function exists(ref: BoardRef): Promise<boolean> {
    try {
      await repos.boards.get(ref);
      return true;
    } catch (err) {
      if (err instanceof NotFoundError) return false;
      throw err;
    }
  }
}

/** Story counts per Stage key on a Board, for `boards show` and the TUI (Stage keys with no Stories are omitted). */
export async function storyCountsByStage(ctx: RowblyContext, ref: BoardRef): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const story of await createRepositories(ctx.root).stories.allInBoard(ref)) {
    counts[story.stage] = (counts[story.stage] ?? 0) + 1;
  }
  return counts;
}

function parseBoard(input: unknown): BoardConfig {
  const result = BoardConfigSchema.safeParse(input);
  if (!result.success) throw new ValidationError('invalid Board', { details: { issues: result.error.issues } });
  return result.data;
}
