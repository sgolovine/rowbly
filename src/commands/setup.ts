import { homedir } from 'node:os';
import { confirm, isCancel } from '@clack/prompts';
import type { Command } from 'commander';
import { UsageError } from '../core';
import { colorByCategory, colors, describeSource, printResult, printWarnings, renderTable } from '../output';
import type { CustomFieldDef, EffectiveBoardConfig } from '../schemas';
import {
  applyGlobalMe,
  createServices,
  type Identity,
  type InitOptions,
  type InitResult,
  identity,
  type RowblyContext,
  readGlobalMe,
  type Services,
  setGlobalMe,
} from '../services';
import { assertInitTarget, initTarget, newContext } from '../services/setup';
import { assertNoRootEnv, registerDataRoot } from '../storage';
import {
  boardFlag,
  type ContextFlags,
  globalOptions,
  isInteractive,
  promptIfMissing,
  withContext,
  withOptionalContext,
} from './_shared';

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
    .description('Show or set Me, the handle you work as: global Me, or a local Me for this Data Root')
    .option('--clear', 'unset Me')
    .option('--local', "set or clear this Data Root's local Me, which replaces global Me here")
    .action((handle: string | undefined, opts: { clear?: boolean; local?: boolean }, cmd: Command) => {
      if (opts.clear && handle) throw new UsageError('use either a handle or --clear');
      const change = opts.clear ? null : handle;
      if (opts.local) {
        return withContext(cmd, async ({ ctx, services, globals }) => {
          if (change !== undefined) await services.context.setMe(change);
          const result = identity(ctx.local, ctx.globalMe ?? null);
          printResult(result, { json: globals.json, human: (r) => renderSetLocal(r, change) });
        });
      }
      return withOptionalContext(cmd, async ({ ctx, globals }) => {
        let globalMe: string | null;
        if (change !== undefined) {
          globalMe = await setGlobalMe(ctx?.home ?? homedir(), change);
          if (ctx) applyGlobalMe(ctx, globalMe);
        } else {
          globalMe = ctx ? (ctx.globalMe ?? null) : await readGlobalMe(homedir());
        }
        const result = identity(ctx?.local ?? null, globalMe);
        const human = change === undefined ? renderIdentity : (r: Identity) => renderSetGlobal(r, change);
        printResult(result, { json: globals.json, human });
      });
    });

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
    assertNoRootEnv(process.env);
    const root = initTarget({
      cwd: process.cwd(),
      home: homedir(),
      explicit: globals.root,
      global: opts.global ?? false,
    });
    const ctx = newContext(root, (message) => warnings.push(message));
    // Fail before any prompt rather than after the last one.
    await assertInitTarget(root);
    const board = await firstBoard(opts, globals);
    const result = await createServices(ctx).setup.init({ root, ...(board ? { board } : {}) });
    // The new Data Root is known from now on (ADR-0033 §2); the Data Root itself is already made.
    await registerDataRoot(homedir(), root.path).catch((err: unknown) =>
      warnings.push(`Data Root not recorded in the Home Config: ${err instanceof Error ? err.message : String(err)}`),
    );
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

function renderIdentity({ me, source, global }: Identity): string {
  if (me === null) return 'Me is not set. Claim a handle with `rowbly whoami <handle>`.';
  if (source === 'global') return `${colors.bold(me)}  ${colors.dim('(global Me)')}`;
  return `${colors.bold(me)}  ${colors.dim(global ? `(local Me; global Me is ${global})` : '(local Me)')}`;
}

function renderSetGlobal({ me, local }: Identity, change: string | null): string {
  if (local === null) return change === null ? 'Cleared global Me' : `You are ${change}`;
  const first = change === null ? 'Cleared global Me' : `Global Me is ${change}`;
  return `${first}\nIn this Data Root you are ${me}, its local Me (\`rowbly whoami --local --clear\` removes it)`;
}

function renderSetLocal(result: Identity, change: string | null | undefined): string {
  if (change === undefined) return renderIdentity(result);
  if (change !== null) return `You are ${change} in this Data Root`;
  return result.me === null ? 'Cleared the local Me; Me is not set' : `Cleared the local Me; you are ${result.me}`;
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
