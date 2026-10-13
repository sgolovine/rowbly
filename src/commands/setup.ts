import { homedir } from 'node:os';
import { confirm, isCancel } from '@clack/prompts';
import type { Command } from 'commander';
import { UsageError } from '../core';
import { colorByCategory, colors, printResult, printWarnings, renderTable } from '../output';
import type { CustomFieldDef, EffectiveBoardConfig } from '../schemas';
import { createServices, type InitOptions, type InitResult, type RowblyContext, type Services } from '../services';
import { assertInitTarget, claimMe, initTarget, type MeSource, meSource, newContext } from '../services/setup';
import {
  boardFlag,
  type ContextFlags,
  globalOptions,
  isInteractive,
  promptIfMissing,
  withContext,
  workspaceFlag,
} from './_shared';

interface InitFlags {
  global?: boolean;
  workspace?: string;
  workspaceName?: string;
  board?: string;
  boardName?: string;
  prefix?: string;
}

type ContextSource = 'flag' | 'env' | 'local' | 'only';

/** What `use` prints: the current Workspace and Board and where each was resolved from. */
interface CurrentContext {
  workspace: { id: string; source: ContextSource } | null;
  board: { id: string; source: ContextSource } | null;
}

export function registerSetup(program: Command): void {
  program
    .command('init')
    .description('Create a Data Root, optionally with a first Workspace and Board')
    .option('--global', 'create ~/.rowbly instead of .rowbly in the current directory')
    .option('--workspace <id>', 'first Workspace id')
    .option('--workspace-name <name>', 'first Workspace name')
    .option('--board <id>', 'first Board id (needs --workspace)')
    .option('--board-name <name>', 'first Board name')
    .option('--prefix <PREFIX>', 'first Board Story Key prefix (default suggestion: the Board id upper-cased)')
    .action((opts: InitFlags, cmd: Command) => runInit(opts, cmd));

  program
    .command('use [target]')
    .description('Show or set the current Workspace and Board (target: <workspace>[/<board>])')
    .option('--clear', 'forget the current Workspace and Board')
    .option('--workspace <id>', 'resolve the shown context with this Workspace')
    .option('--board <id>', 'resolve the shown context with this Board')
    .action((target: string | undefined, opts: ContextFlags & { clear?: boolean }, cmd: Command) =>
      withContext(cmd, async ({ ctx, services, globals }) => {
        if (opts.clear) {
          if (target) throw new UsageError('use either a target or --clear');
          await services.context.clearUse();
          printResult(ctx.local, { json: globals.json, human: () => 'Cleared the current Workspace and Board' });
          return;
        }
        if (target) {
          const [ws, board, ...extra] = target.split('/');
          if (!ws || extra.length > 0 || board === '') {
            throw new UsageError(`invalid target "${target}"`, { hint: 'expected <workspace> or <workspace>/<board>' });
          }
          const local = await services.context.use(ws, board);
          printResult(local, {
            json: globals.json,
            human: (l) => `Now using ${[l.workspace, l.board].filter(Boolean).join('/')}`,
          });
          return;
        }
        printResult(await currentContext(ctx, services, opts), { json: globals.json, human: renderCurrentContext });
      }),
    );

  program
    .command('whoami [handle]')
    .description('Show or set Me, the Assignee handle you work as')
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
          await claimMe(ctx, handle);
          printResult({ me: handle }, { json: globals.json, human: () => `You are ${handle}` });
          return;
        }
        printResult({ me: ctx.me, source: meSource(ctx) }, { json: globals.json, human: renderMe });
      }),
    );

  const config = program.command('config').description('Show configuration');
  config
    .command('show')
    .description('Show the effective Stages and Custom Fields of a Board, with the level each comes from')
    .option('--workspace <id>', 'the Workspace (default: current context)')
    .option('--board <id>', 'the Board, or <workspace>/<board> (default: current context)')
    .action((opts: ContextFlags, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        const ref = await services.context.resolveBoard(boardFlag(opts), workspaceFlag(opts));
        printResult(await services.config.effective(ref), { json: globals.json, human: renderEffective });
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
    const firstOnes = await firstWorkspaceAndBoard(opts, globals);
    const result = await createServices(ctx).setup.init({ root, ...firstOnes });
    printResult(result, { json: globals.json, human: renderInit });
  } finally {
    printWarnings(warnings, { json: globals.json });
  }
}

/** The first Workspace and Board from the flags, asking for the rest through Clack when interactive. */
async function firstWorkspaceAndBoard(
  opts: InitFlags,
  globals: ReturnType<typeof globalOptions>,
): Promise<Omit<InitOptions, 'root'>> {
  let wsId = opts.workspace;
  let boardId = opts.board;
  if (wsId === undefined && boardId === undefined && opts.workspaceName === undefined && isInteractive(globals)) {
    const answer = await confirm({ message: 'Create a first Workspace and Board now?', initialValue: true });
    if (isCancel(answer)) throw new UsageError('cancelled');
    if (!answer) return {};
    wsId = await promptIfMissing(undefined, globals, { flag: '--workspace', message: 'Workspace id (e.g. acme)' });
    boardId = await promptIfMissing(undefined, globals, { flag: '--board', message: 'Board id (e.g. web)' });
  }
  if (wsId === undefined) {
    if (boardId !== undefined) throw new UsageError('--board needs --workspace');
    return {};
  }
  const workspace = {
    id: wsId,
    name: await promptIfMissing(opts.workspaceName, globals, { flag: '--workspace-name', message: 'Workspace name' }),
  };
  if (boardId === undefined) return { workspace };
  const board = {
    id: boardId,
    name: await promptIfMissing(opts.boardName, globals, { flag: '--board-name', message: 'Board name' }),
    keyPrefix: await promptIfMissing(opts.prefix, globals, {
      flag: '--prefix',
      message: 'Story Key prefix',
      initialValue: boardId.toUpperCase(),
    }),
  };
  return { workspace, board };
}

/**
 * Resolves the Workspace and Board as `services.context` does (contracts §4) and records which step
 * supplied each. An unresolvable part is `null` rather than an error, since `use` only reports.
 */
async function currentContext(ctx: RowblyContext, services: Services, opts: ContextFlags): Promise<CurrentContext> {
  const wsFlag = workspaceFlag(opts);
  const bFlag = boardFlag(opts);
  const source = (flag: string | undefined, given: string | undefined, local: boolean): ContextSource =>
    flag ? (given ? 'flag' : 'env') : local ? 'local' : 'only';

  const ref = await orNull(services.context.resolveBoard(bFlag, wsFlag));
  // `--board ws/board` names its own Workspace.
  const workspaceId = ref && bFlag?.includes('/') ? null : await orNull(services.context.resolveWorkspace(wsFlag));
  const board = ref && {
    id: ref.boardId,
    source: source(bFlag, opts.board, ctx.local.workspace === ref.workspaceId && ctx.local.board === ref.boardId),
  };
  if (workspaceId === null)
    return { workspace: ref && { id: ref.workspaceId, source: board?.source ?? 'flag' }, board };
  return {
    workspace: { id: workspaceId, source: source(wsFlag, opts.workspace, ctx.local.workspace === workspaceId) },
    board,
  };
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

function renderCurrentContext(c: CurrentContext): string {
  const line = (label: string, part: CurrentContext['workspace']) =>
    `${label}  ${part ? `${colors.bold(part.id)}  ${colors.dim(`(${SOURCE_LABELS[part.source]})`)}` : colors.dim('(none)')}`;
  return [line('Workspace', c.workspace), line('Board    ', c.board)].join('\n');
}

const ME_SOURCE_LABELS: Record<MeSource, string> = { local: 'from local.json', git: 'matched by git email' };

function renderMe({ me, source }: { me: string | null; source: MeSource | null }): string {
  if (me === null || source === null) return 'Me is not set. Claim a handle with `rowbly whoami <handle>`.';
  return `${colors.bold(me)}  ${colors.dim(`(${ME_SOURCE_LABELS[source]})`)}`;
}

function renderInit(result: InitResult): string {
  const lines = [`Created Data Root ${result.root.path}`];
  if (result.workspace) lines.push(`Created Workspace ${result.workspace.id}  ${result.workspace.name}`);
  if (result.board)
    lines.push(`Created Board ${result.board.workspaceId}/${result.board.id} (${result.board.keyPrefix})`);
  if (result.workspace) lines.push(`Now using ${[result.workspace.id, result.board?.id].filter(Boolean).join('/')}`);
  else lines.push('Next: `rowbly workspaces create <id> --name <name>`');
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
    `${colors.bold(`${board.workspaceId}/${board.id}`)}  ${board.name} (${board.keyPrefix})`,
    '',
    `Stages ${colors.dim(`(from ${config.stagesSource})`)}`,
    stages,
    '',
    `Custom Fields ${colors.dim(`(from ${config.customFieldsSource})`)}`,
    fields,
  ].join('\n');
}

function fieldRow(field: CustomFieldDef): string[] {
  const options = 'options' in field ? field.options.join(', ') : '';
  return [field.key, field.name, field.type, field.required ? 'yes' : '', options];
}
