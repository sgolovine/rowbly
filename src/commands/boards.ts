import type { Command } from 'commander';
import { UsageError } from '../core';
import { colorByCategory, colors, describeSource, printResult, renderTable } from '../output';
import type { BoardConfig, CustomFieldDef, EffectiveBoardConfig } from '../schemas';
import { storyCountsByStage } from '../services/boards';
import { boardFlag, confirmDestructive, promptIfMissing, withContext } from './_shared';

interface BoardOptions {
  name?: string;
  prefix?: string;
  description?: string;
  force?: boolean;
}

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
        const board = await services.boards.create({ id, name, keyPrefix, description: opts.description });
        printResult(board, {
          json: globals.json,
          human: (b) => `Created Board ${b.id} (${b.keyPrefix})`,
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
        if (opts.name === undefined && opts.description === undefined) {
          throw new UsageError('nothing to change', { hint: 'pass --name and/or --description' });
        }
        const board = await services.boards.update(id, { name: opts.name, description: opts.description });
        printResult(board, { json: globals.json, human: (b) => `Updated Board ${b.id}` });
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
        await services.boards.remove(boardId, { force: opts.force ?? false });
        printResult({ deleted: boardId }, { json: globals.json, human: () => `Deleted Board ${boardId}` });
      }),
    );
}

function renderBoards(boards: BoardConfig[]): string {
  if (boards.length === 0) return colors.dim('No Boards yet. Create one with `rowbly boards create <id>`.');
  return renderTable(
    ['ID', 'PREFIX', 'NAME', 'DESCRIPTION'],
    boards.map((b) => [b.id, b.keyPrefix, b.name, b.description]),
  );
}

function renderBoardShow(data: EffectiveBoardConfig & { storyCounts: Record<string, number> }): string {
  const { board, storyCounts } = data;
  const lines = [`${colors.bold(board.name)} ${colors.dim(board.id)}`, `Key prefix: ${board.keyPrefix}`];
  if (board.description) lines.push(board.description);
  lines.push(
    '',
    colors.bold(`Stages (${describeSource(data.stagesSource)})`),
    renderTable(
      ['KEY', 'NAME', 'CATEGORY', 'STORIES'],
      data.stages.map((s) => [s.key, colorByCategory(s.category, s.name), s.category, String(storyCounts[s.key] ?? 0)]),
    ),
  );
  const unknown = Object.keys(storyCounts).filter((key) => !data.stages.some((s) => s.key === key));
  for (const key of unknown) {
    lines.push(colors.yellow(`${storyCounts[key]} Stories are in unknown Stage "${key}" (run \`rowbly doctor\`)`));
  }
  lines.push('', colors.bold(`Custom Fields (${describeSource(data.customFieldsSource)})`));
  lines.push(data.customFields.length === 0 ? colors.dim('none') : renderFieldTable(data.customFields));
  return lines.join('\n');
}

/** KEY, NAME, TYPE, REQUIRED and the type-specific settings of each Custom Field. */
export function renderFieldTable(fields: readonly CustomFieldDef[]): string {
  return renderTable(
    ['KEY', 'NAME', 'TYPE', 'REQUIRED', 'SETTINGS'],
    fields.map((f) => [f.key, f.name, f.type, f.required ? 'yes' : 'no', fieldSettings(f)]),
  );
}

function fieldSettings(f: CustomFieldDef): string {
  if (f.type === 'select' || f.type === 'multiselect') return f.options.join(', ');
  if (f.type === 'number') {
    return [
      f.integer ? 'integer' : '',
      f.min !== undefined ? `min ${f.min}` : '',
      f.max !== undefined ? `max ${f.max}` : '',
    ]
      .filter(Boolean)
      .join(', ');
  }
  return '';
}
