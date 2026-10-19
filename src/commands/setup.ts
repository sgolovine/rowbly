import { homedir } from 'node:os';
import { confirm, isCancel } from '@clack/prompts';
import type { Command } from 'commander';
import { UsageError } from '../core';
import { colorByCategory, colors, describeSource, printResult, printWarnings, renderTable } from '../output';
import type { CustomFieldDef, EffectiveBoardConfig } from '../schemas';
import { createServices, type InitOptions, type InitResult, type RowblyContext, type Services } from '../services';
import { assertInitTarget, initTarget, newContext } from '../services/setup';
import { boardFlag, type ContextFlags, globalOptions, isInteractive, promptIfMissing, withContext } from './_shared';

interface InitFlags {
  global?: boolean;
  board?: string;
  boardName?: string;
  prefix?: string;
}

type ContextSource = 'flag' | 'env' | 'local' | 'only';

/** What `use` prints: the current Board and where it was resolved from. */
interface CurrentContext {
  board: { id: string; source: ContextSource } | null;
}

export function registerSetup(program: Command): void {
  program
    .command('init')
    .description('Create a Data Root, optionally with a first Board')
    .option('--global', 'create ~/.rowbly instead of .rowbly in the current directory')
    .option('--board <id>', 'first Board id')
    .option('--board-name <name>', 'first Board name')
    .option('--prefix <PREFIX>', 'first Board Story Key prefix (default suggestion: the Board id upper-cased)')
    .action((opts: InitFlags, cmd: Command) => runInit(opts, cmd));

  program
    .command('use [board]')
    .description('Show or set the current Board')
    .option('--clear', 'forget the current Board')
    .option('--board <id>', 'resolve the shown context with this Board')
    .action((target: string | undefined, opts: ContextFlags & { clear?: boolean }, cmd: Command) =>
      withContext(cmd, async ({ ctx, services, globals }) => {
        if (opts.clear) {
          if (target) throw new UsageError('use either a Board or --clear');
          await services.context.clearUse();
          printResult(ctx.local, { json: globals.json, human: () => 'Cleared the current Board' });
          return;
        }
        if (target) {
          const local = await services.context.use(target);
          printResult(local, { json: globals.json, human: (l) => `Now using ${l.board}` });
          return;
        }
        printResult(await currentContext(ctx, services, opts), { json: globals.json, human: renderCurrentContext });
      }),
    );

  program
    .command('whoami [handle]')
    .description('Show or set Me, the handle you work as')
    .option('--clear', 'unset Me')
    .action((handle: string | undefined, opts: { clear?: boolean }, cmd: Command) =>
      withContext(cmd, async ({ ctx, services, globals }) => {
        if (opts.clear) {
          if (handle) throw new UsageError('use either a handle or --clear');
          await services.context.setMe(null);
          printResult({ me: null }, { json: globals.json, human: () => 'Cleared Me' });
          return;
        }
        if (handle) {
          await services.context.setMe(handle);
          printResult({ me: handle }, { json: globals.json, human: () => `You are ${handle}` });
          return;
        }
        printResult({ me: ctx.me }, { json: globals.json, human: renderMe });
      }),
    );

  const config = program.command('config').description('Show configuration');
  config
    .command('show')
    .description('Show the effective Stages and Custom Fields of a Board, with the level each comes from')
    .option('--board <id>', 'the Board (default: current context)')
    .action((opts: ContextFlags, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        const boardId = await services.context.resolveBoard(boardFlag(opts));
        printResult(await services.config.effective(boardId), { json: globals.json, human: renderEffective });
      }),
    );
}

async function runInit(opts: InitFlags, cmd: Command): Promise<void> {
  const globals = globalOptions(cmd);
  const warnings: string[] = [];
  try {
    const root = initTarget({
      cwd: process.cwd(),
      home: homedir(),
      explicit: globals.root || process.env.ROWBLY_ROOT || undefined,
      global: opts.global ?? false,
    });
    const ctx = newContext(root, (message) => warnings.push(message));
    // Fail before any prompt rather than after the last one.
    await assertInitTarget(root);
    const board = await firstBoard(opts, globals);
    const result = await createServices(ctx).setup.init({ root, ...(board ? { board } : {}) });
    printResult(result, { json: globals.json, human: renderInit });
  } finally {
    printWarnings(warnings, { json: globals.json });
  }
}

/** The first Board from the flags, asking for the rest through Clack when interactive. */
async function firstBoard(
  opts: InitFlags,
  globals: ReturnType<typeof globalOptions>,
): Promise<InitOptions['board'] | undefined> {
  let boardId = opts.board;
  if (boardId === undefined && opts.boardName === undefined && isInteractive(globals)) {
    const answer = await confirm({ message: 'Create a first Board now?', initialValue: true });
    if (isCancel(answer)) throw new UsageError('cancelled');
    if (!answer) return undefined;
    boardId = await promptIfMissing(undefined, globals, { flag: '--board', message: 'Board id (e.g. web)' });
  }
  if (boardId === undefined) return undefined;
  return {
    id: boardId,
    name: await promptIfMissing(opts.boardName, globals, { flag: '--board-name', message: 'Board name' }),
    keyPrefix: await promptIfMissing(opts.prefix, globals, {
      flag: '--prefix',
      message: 'Story Key prefix',
      initialValue: boardId.toUpperCase(),
    }),
  };
}

/**
 * Resolves the Board as `services.context` does (contracts §4) and records which step supplied it.
 * An unresolvable Board is `null` rather than an error, since `use` only reports.
 */
async function currentContext(ctx: RowblyContext, services: Services, opts: ContextFlags): Promise<CurrentContext> {
  const flag = boardFlag(opts);
  const boardId = await orNull(services.context.resolveBoard(flag));
  if (boardId === null) return { board: null };
  const source: ContextSource = flag ? (opts.board ? 'flag' : 'env') : ctx.local.board === boardId ? 'local' : 'only';
  return { board: { id: boardId, source } };
}

/** `null` when the context cannot be resolved. */
async function orNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof UsageError) return null;
    throw err;
  }
}

const SOURCE_LABELS: Record<ContextSource, string> = {
  flag: 'from flag',
  env: 'from environment',
  local: 'from local.json',
  only: 'the only one',
};

function renderCurrentContext({ board }: CurrentContext): string {
  return `Board  ${board ? `${colors.bold(board.id)}  ${colors.dim(`(${SOURCE_LABELS[board.source]})`)}` : colors.dim('(none)')}`;
}

function renderMe({ me }: { me: string | null }): string {
  if (me === null) return 'Me is not set. Claim a handle with `rowbly whoami <handle>`.';
  return colors.bold(me);
}

function renderInit(result: InitResult): string {
  const lines = [`Created Data Root ${result.root.path}`];
  if (result.board) {
    lines.push(`Created Board ${result.board.id} (${result.board.keyPrefix})`, `Now using ${result.board.id}`);
  } else {
    lines.push('Next: `rowbly boards create <id> --name <name> --prefix <PREFIX>`');
  }
  return lines.join('\n');
}

function renderEffective(config: EffectiveBoardConfig): string {
  const { board } = config;
  const stages = renderTable(
    ['KEY', 'NAME', 'CATEGORY'],
    config.stages.map((s) => [s.key, s.name, colorByCategory(s.category, s.category)]),
  );
  const fields =
    config.customFields.length === 0
      ? colors.dim('none')
      : renderTable(['KEY', 'NAME', 'TYPE', 'REQUIRED', 'OPTIONS'], config.customFields.map(fieldRow));
  return [
    `${colors.bold(board.id)}  ${board.name} (${board.keyPrefix})`,
    '',
    `Stages ${colors.dim(`(${describeSource(config.stagesSource)})`)}`,
    stages,
    '',
    `Custom Fields ${colors.dim(`(${describeSource(config.customFieldsSource)})`)}`,
    fields,
  ].join('\n');
}

function fieldRow(field: CustomFieldDef): string[] {
  const options = 'options' in field ? field.options.join(', ') : '';
  return [field.key, field.name, field.type, field.required ? 'yes' : '', options];
}
