import { homedir } from 'node:os';
import type { Command } from 'commander';
import { UsageError } from '../../core';
import { printResult, printWarnings } from '../../output';
import { applyGlobalMe, type Identity, identity, readGlobalMe, setGlobalMe } from '../../services';
import { assertInitTarget, createDataRoot } from '../../services/setup';
import { assertNoRootEnv } from '../../storage';
import { boardFlag, type ContextFlags, globalOptions, withContext, withOptionalContext } from '../shared';
import {
  renderContextCleared,
  renderContextSet,
  renderCurrentContext,
  renderEffective,
  renderGlobalIdentity,
  renderInit,
  renderSetLocal,
} from './render';
import type { InitFlags } from './types';
import { askDefault, askLabel, currentContext, firstBoard, initRoot } from './util';

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
          printResult(ctx.local, { json: globals.json, human: renderContextCleared });
          return;
        }
        if (target) {
          const local = await services.context.use(target);
          printResult(local, { json: globals.json, human: renderContextSet });
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
        const human = (r: Identity) => renderGlobalIdentity(r, change);
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
