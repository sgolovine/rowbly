import { ConflictError, NotFoundError, toTimestamp, ValidationError } from '../core';
import { type BoardConfig, BoardConfigSchema, type Slug } from '../schemas';
import { createRepositories, type Repositories } from '../storage';
import type { OperationRunner } from './plugins/runtime';
import type { BoardsService, RowblyContext } from './types';

export function createBoardsService(ctx: RowblyContext, repos: Repositories, ops: OperationRunner): BoardsService {
  return {
    list: () => repos.boards.list(),

    get: (id) => repos.boards.get(id),

    create: (input) =>
      ops.run('boards.create', input, async (changes) => {
        const now = toTimestamp(ctx.now());
        const board = parseBoard({
          version: 1,
          id: input.id,
          name: input.name,
          description: input.description ?? '',
          keyPrefix: input.keyPrefix.toUpperCase(),
          createdAt: now,
          updatedAt: now,
        });
        if (await exists(board.id)) {
          throw new ConflictError(`Board "${board.id}" already exists`);
        }
        const holder = await repos.boards.findByPrefix(board.keyPrefix);
        if (holder) {
          throw new ConflictError(`key prefix "${board.keyPrefix}" is already used by Board "${holder.id}"`, {
            hint: 'key prefixes are unique across the Data Root; choose another --prefix',
          });
        }
        // Stages and Custom Fields are inherited until a level is edited (copy-on-write).
        return changes.putBoard(board);
      }),

    update: (id, patch) =>
      ops.run('boards.update', { id, ...patch }, async (changes) => {
        const board = await repos.boards.get(id);
        return changes.putBoard(
          parseBoard({
            ...board,
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.description !== undefined ? { description: patch.description } : {}),
            updatedAt: toTimestamp(ctx.now()),
          }),
        );
      }),

    async remove(id, opts) {
      const board = await repos.boards.get(id);
      const local = await ops.run('boards.remove', { ...opts, id: board.id }, async (changes) => {
        if (!opts.force) {
          const stories = await repos.stories.allInBoard(board.id);
          if (stories.length > 0) {
            throw new ConflictError(`Board "${board.id}" has ${stories.length} Stories`, {
              details: { stories: stories.length },
              hint: 'pass --force to delete it with all its Stories',
            });
          }
        }
        // Its folder goes with it: Stories and Plugin files too (ADR-0013).
        await changes.deleteBoard(board.id);
        if (ctx.local.board !== board.id) return null;
        return changes.updateLocalState(({ board: _current, ...rest }) => rest);
      });
      if (local) ctx.local = local;
    },
  };

  async function exists(id: Slug): Promise<boolean> {
    try {
      await repos.boards.get(id);
      return true;
    } catch (err) {
      if (err instanceof NotFoundError) return false;
      throw err;
    }
  }
}

/** Story counts per Stage key on a Board, for `boards show` and the TUI (Stage keys with no Stories are omitted). */
export async function storyCountsByStage(ctx: RowblyContext, boardId: Slug): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const story of await createRepositories(ctx.root).stories.allInBoard(boardId)) {
    counts[story.stage] = (counts[story.stage] ?? 0) + 1;
  }
  return counts;
}

function parseBoard(input: unknown): BoardConfig {
  const result = BoardConfigSchema.safeParse(input);
  if (!result.success) throw new ValidationError('invalid Board', { details: { issues: result.error.issues } });
  return result.data;
}
