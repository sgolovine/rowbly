import { confirm, isCancel, select, text } from '@clack/prompts';
import { UsageError } from '../../core';
import type { InitOptions, RowblyContext, Services } from '../../services';
import { initTarget, type SetupLocation, setupTarget } from '../../services/setup';
import { boardFlag, type ContextFlags, type globalOptions, isInteractive, promptIfMissing } from '../shared';
import type { ContextSource, CurrentContext, InitFlags } from './types';

/**
 * Where `init` creates the Data Root: `--data-root`, `--global`, or asked when interactive (the
 * current directory, the home folder or a custom path); `<cwd>/.rowbly` otherwise.
 */
export async function initRoot(
  opts: InitFlags,
  globals: ReturnType<typeof globalOptions>,
  at: { cwd: string; home: string },
) {
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
export async function askLabel(
  opts: InitFlags,
  globals: ReturnType<typeof globalOptions>,
): Promise<string | undefined> {
  if (opts.label !== undefined || !isInteractive(globals)) return opts.label;
  const answer = await text({ message: 'Label (optional, e.g. Work)', placeholder: 'leave empty for none' });
  if (isCancel(answer)) throw new UsageError('cancelled');
  return answer?.trim() || undefined;
}

/** `--default`, or asked when interactive. */
export async function askDefault(opts: InitFlags, globals: ReturnType<typeof globalOptions>): Promise<boolean> {
  if (opts.default || !isInteractive(globals)) return opts.default ?? false;
  const answer = await confirm({
    message: 'Make it the default Data Root, opened from every directory?',
    initialValue: false,
  });
  if (isCancel(answer)) throw new UsageError('cancelled');
  return answer;
}

/** The first Board from the flags, asking for the rest through Clack when interactive. */
export async function firstBoard(
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
export async function currentContext(
  ctx: RowblyContext,
  services: Services,
  opts: ContextFlags,
): Promise<CurrentContext> {
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
