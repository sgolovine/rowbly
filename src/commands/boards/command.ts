import type { Command } from 'commander';
import { UsageError } from '../../core';
import { printResult } from '../../output';
import { storyCountsByStage } from '../../services/boards';
import { boardFlag, confirmDestructive, pluginOptions, promptIfMissing, withContext } from '../shared';
import { renderBoardCreated, renderBoardDeleted, renderBoardShow, renderBoards, renderBoardUpdated } from './render';
import type { BoardOptions } from './types';

export function registerBoards(program: Command): void {
  const boards = program.command('boards').description('Manage Boards');

  boards
    .command('list')
    .description('List the Boards')
    .action(async (_opts: unknown, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        printResult(await services.boards.list(), { json: globals.json, human: renderBoards });
      }),
    );

  boards
    .command('create <id>')
    .description('Create a Board with a key prefix that is unique across the Data Root')
    .option('--name <name>', 'display name')
    .option('--prefix <PREFIX>', 'Story Key prefix, e.g. WEB for WEB-1')
    .option('--description <text>', 'description')
    .action(async (id: string, opts: BoardOptions, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        const name = await promptIfMissing(opts.name, globals, { flag: '--name', message: 'Board name' });
        const keyPrefix = await promptIfMissing(opts.prefix, globals, {
          flag: '--prefix',
          message: 'Story Key prefix (e.g. WEB)',
        });
        const board = await services.boards.create({
          id,
          name,
          keyPrefix,
          description: opts.description,
          ...pluginOptions(cmd),
        });
        printResult(board, {
          json: globals.json,
          human: renderBoardCreated,
        });
      }),
    );

  boards
    .command('show [id]')
    .description('Show a Board with its effective Stages and Custom Fields (default: current Board)')
    .action(async (id: string | undefined, _opts: unknown, cmd: Command) =>
      withContext(cmd, async ({ ctx, services, globals }) => {
        const boardId = await services.context.resolveBoard(id ?? boardFlag({}));
        const effective = await services.config.effective(boardId);
        const storyCounts = await storyCountsByStage(ctx, boardId);
        printResult({ ...effective, storyCounts }, { json: globals.json, human: renderBoardShow });
      }),
    );

  boards
    .command('edit <id>')
    .description("Edit a Board's name or description")
    .option('--name <name>', 'new display name')
    .option('--description <text>', 'new description')
    .action(async (id: string, opts: BoardOptions, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        const operationOptions = pluginOptions(cmd);
        if (opts.name === undefined && opts.description === undefined && !operationOptions.plugins) {
          throw new UsageError('nothing to change', { hint: 'pass --name and/or --description' });
        }
        const board = await services.boards.update(id, {
          name: opts.name,
          description: opts.description,
          ...operationOptions,
        });
        printResult(board, { json: globals.json, human: renderBoardUpdated });
      }),
    );

  boards
    .command('delete <id>')
    .description('Delete a Board (refused when it has Stories, unless --force)')
    .option('--force', 'also delete all of its Stories')
    .action(async (id: string, opts: BoardOptions, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        const boardId = (await services.boards.get(id)).id;
        await confirmDestructive(
          opts.force ? `Delete Board ${boardId} and all of its Stories?` : `Delete Board ${boardId}?`,
          globals,
        );
        await services.boards.remove(boardId, { force: opts.force ?? false, ...pluginOptions(cmd) });
        printResult({ deleted: boardId }, { json: globals.json, human: renderBoardDeleted });
      }),
    );
}
