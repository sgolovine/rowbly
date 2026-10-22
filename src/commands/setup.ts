import { homedir } from 'node:os';
import { confirm, isCancel, select, text } from '@clack/prompts';
import type { Command } from 'commander';
import { UsageError } from '../core';
import { colorByCategory, colors, describeSource, printResult, printWarnings, renderTable } from '../output';
import type { CustomFieldDef, EffectiveBoardConfig } from '../schemas';
import {
  applyGlobalMe,
  type Identity,
  type InitOptions,
  identity,
  type RowblyContext,
  readGlobalMe,
  type Services,
  setGlobalMe,
} from '../services';
import {
  assertInitTarget,
  type CreateDataRootResult,
  createDataRoot,
  initTarget,
  type SetupLocation,
  setupTarget,
  shellArg,
} from '../services/setup';
import { assertNoRootEnv } from '../storage';
import {
  boardFlag,
  type ContextFlags,
  globalOptions,
  isInteractive,
  promptIfMissing,
  withContext,
  withOptionalContext,
} from './shared';

interface InitFlags {
  global?: boolean;
  label?: string;
  default?: boolean;
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
    .description('Create a Data Root, optionally with a first Board, and record it in ~/.rowblyrc.json')
    .option('--global', 'create ~/.rowbly instead of .rowbly in the current directory')
    .option('--label <label>', 'a name for the Data Root in ~/.rowblyrc.json')
    .option('--default', 'make it the default Data Root, opened from every directory')
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
    if (opts.global && globals.root) throw new UsageError('use either --global or --data-root');
    const cwd = process.cwd();
    const home = homedir();
    const root = await initRoot(opts, globals, { cwd, home });
    // Fail before any prompt rather than after the last one.
    await assertInitTarget(root);
    const board = await firstBoard(opts, globals);
    const label = await askLabel(opts, globals);
    const makeDefault = await askDefault(opts, globals);
    const result = await createDataRoot({
      root,
      home,
      ...(board ? { board } : {}),
      ...(label ? { label } : {}),
      default: makeDefault,
      warn: (message) => warnings.push(message),
    });
    printResult(result, { json: globals.json, human: renderInit });
  } finally {
    printWarnings(warnings, { json: globals.json });
  }
}

/**
 * Where `init` creates the Data Root: `--data-root`, `--global`, or asked when interactive (the
 * current directory, the home folder or a custom path); `<cwd>/.rowbly` otherwise.
 */
async function initRoot(opts: InitFlags, globals: ReturnType<typeof globalOptions>, at: { cwd: string; home: string }) {
  if (globals.root || opts.global || !isInteractive(globals)) {
    return initTarget({ ...at, explicit: globals.root, global: opts.global ?? false });
  }
  const here = setupTarget('here', at);
  const homeRoot = setupTarget('home', at);
  const location = await select<SetupLocation>({
    message: 'Where should Rowbly keep this Data Root?',
    options: [
      { value: 'here', label: 'This directory', hint: here.path },
      { value: 'home', label: 'Home folder', hint: homeRoot.path },
      { value: 'custom', label: 'Another folder', hint: 'type the path of the Data Root folder' },
    ],
  });
  if (isCancel(location)) throw new UsageError('cancelled');
  if (location !== 'custom') return location === 'home' ? homeRoot : here;
  const path = await text({
    message: 'Data Root folder (e.g. ~/work/.rowbly)',
    validate: (input) => (input?.trim() ? undefined : 'a path is required'),
  });
  if (isCancel(path)) throw new UsageError('cancelled');
  return setupTarget('custom', { ...at, path });
}

/** `--label`, or asked when interactive; empty means none. */
async function askLabel(opts: InitFlags, globals: ReturnType<typeof globalOptions>): Promise<string | undefined> {
  if (opts.label !== undefined || !isInteractive(globals)) return opts.label;
  const answer = await text({ message: 'Label (optional, e.g. Work)', placeholder: 'leave empty for none' });
  if (isCancel(answer)) throw new UsageError('cancelled');
  return answer?.trim() || undefined;
}

/** `--default`, or asked when interactive. */
async function askDefault(opts: InitFlags, globals: ReturnType<typeof globalOptions>): Promise<boolean> {
  if (opts.default || !isInteractive(globals)) return opts.default ?? false;
  const answer = await confirm({
    message: 'Make it the default Data Root, opened from every directory?',
    initialValue: false,
  });
  if (isCancel(answer)) throw new UsageError('cancelled');
  return answer;
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

function renderInit(result: CreateDataRootResult): string {
  const name = result.known.label ? ` "${result.known.label}"` : '';
  const lines = [`Created Data Root${name} ${result.root.path}${result.known.default ? ' (the default)' : ''}`];
  if (result.board) {
    lines.push(`Created Board ${result.board.id} (${result.board.keyPrefix})`, `Now using ${result.board.id}`);
  } else {
    // It names the new Data Root, since a default Data Root would otherwise be opened ahead of it.
    lines.push(
      `Next: \`rowbly --data-root ${shellArg(result.root.path)} boards create <id> --name <name> --prefix <PREFIX>\``,
    );
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
