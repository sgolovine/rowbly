import { join, resolve } from 'node:path';
import { nanoid } from 'nanoid';
import { ConflictError, RowblyError, toTimestamp, ValidationError } from '../core';
import { BoardConfigSchema, type DataRoot, DEFAULT_STAGES, type KnownDataRoot } from '../schemas';
import {
  canonicalDataRootPath,
  createRepositories,
  homeConfigPath,
  listKnownDataRoots,
  pathExists,
  type Repositories,
  readHomeConfig,
  registerDataRoot,
  writeTextFile,
} from '../storage';
import { validInput } from './_validate';
import { createServices } from './index';
import type { BoardCreateInput, InitResult, RowblyContext, SetupService } from './types';

const DATA_ROOT_DIR = '.rowbly';

/**
 * Where `init` creates the Data Root: an explicit `--data-root` path, else `~/.rowbly`
 * with `global`, else `<cwd>/.rowbly`. Unlike `findDataRoot`, the path need not exist yet.
 */
export function initTarget(opts: { cwd: string; home: string; explicit?: string; global: boolean }): DataRoot {
  const globalPath = join(resolve(opts.home), DATA_ROOT_DIR);
  const path = opts.explicit
    ? resolve(opts.cwd, opts.explicit)
    : opts.global
      ? globalPath
      : join(opts.cwd, DATA_ROOT_DIR);
  return { path, kind: path === globalPath ? 'global' : 'local' };
}

/** Where setup creates a Data Root: the current directory (`<cwd>/.rowbly`), the home folder, or a custom path. */
export type SetupLocation = 'here' | 'home' | 'custom';

/**
 * The Data Root that setup creates for `location`. A custom `path` is the Data Root folder itself;
 * a leading `~/` is the home folder and a relative path is resolved against `cwd`.
 */
export function setupTarget(location: SetupLocation, opts: { cwd: string; home: string; path?: string }): DataRoot {
  if (location !== 'custom') return initTarget({ ...opts, global: location === 'home' });
  const path = opts.path?.trim() ?? '';
  if (!path)
    throw new ValidationError('path: required', { details: { issues: [{ path: ['path'], message: 'required' }] } });
  const expanded = path === '~' || path.startsWith('~/') ? join(opts.home, path.slice(1)) : path;
  return initTarget({ ...opts, explicit: expanded, global: false });
}

/** `init` refuses a target that already exists; callers check it before asking for anything else. */
export async function assertInitTarget(root: DataRoot): Promise<void> {
  if (await pathExists(root.path)) throw new ConflictError(`Data Root already exists: ${root.path}`);
}

/** A `RowblyContext` over a Data Root that may not exist yet, with the real clock and id generator. */
export function newContext(root: DataRoot, warn: (message: string) => void): RowblyContext {
  return { root, local: { version: 1 }, me: null, now: () => new Date(), newId: () => nanoid(8), warn };
}

/**
 * `init` is not an operation: no Plugin can be on before the Data Root exists, and `init` turns
 * none on (ADR-0010).
 */
export function createSetupService(ctx: RowblyContext, _repos: Repositories): SetupService {
  return {
    async init({ root, board }) {
      // Check everything before writing anything, so a bad id never leaves a half-made Data Root.
      const now = toTimestamp(ctx.now());
      if (board) {
        const { plugins: _plugins, ...fields } = board;
        validInput(BoardConfigSchema, 'Board', {
          version: 1,
          ...fields,
          keyPrefix: fields.keyPrefix.toUpperCase(),
          description: fields.description ?? '',
          createdAt: now,
          updatedAt: now,
        });
      }
      await assertInitTarget(root);

      const repos = createRepositories(root);
      await repos.rootConfig.put({
        version: 1,
        stages: DEFAULT_STAGES.map((stage) => ({ ...stage })),
      });
      // Local State, the lock and the journal are never Git data (ADR-0019 §2).
      await writeTextFile(join(root.path, '.gitignore'), 'local.json\n.lock\n.lock.break\n.txn/\n');
      if (!board) return { root, board: null };

      // Everything below runs against the new Data Root.
      const target: RowblyContext = { ...ctx, root, local: { version: 1 }, me: null };
      const services = createServices(target);
      const createdBoard = await services.boards.create(board);
      await services.context.use(createdBoard.id);
      return { root, board: createdBoard };
    },
  };
}

export interface CreateDataRootOptions {
  root: DataRoot;
  /** The home folder whose Home Config records the new Data Root (ADR-0033 §2). */
  home: string;
  board?: BoardCreateInput;
  /** A name for the Data Root in the Home Config; blank means none. */
  label?: string;
  /** Make it the only default Data Root. Without it, the defaults stay as they are. */
  default?: boolean;
  warn(message: string): void;
}

export interface CreateDataRootResult extends InitResult {
  /** Its entry in the Home Config's known Data Roots. */
  known: KnownDataRoot;
}

/**
 * Setup, for `rowbly init` and the TUI's setup screen: creates the Data Root (and the first Board)
 * and records it in the Home Config with its label and, when asked, as the only default. Everything
 * that can be checked is checked before anything is written: the target, the Board and the Home
 * Config. A failure after the Data Root exists says what was made and how to finish.
 */
export async function createDataRoot(opts: CreateDataRootOptions): Promise<CreateDataRootResult> {
  const { root, home } = opts;
  const label = opts.label?.trim() || undefined;
  await assertInitTarget(root);
  // A Home Config that cannot be read would refuse the entry; fail before the Data Root exists.
  await readHomeConfig(home);
  const result = await finishing(root, () =>
    createServices(newContext(root, opts.warn)).setup.init({ root, ...(opts.board ? { board: opts.board } : {}) }),
  );
  let known: KnownDataRoot;
  try {
    known = await registerDataRoot(home, root.path, { label, ...(opts.default ? { default: true } : {}) });
  } catch (err) {
    throw withHint(
      err,
      `${root.path} was created but is not recorded in ${homeConfigPath(home)}; fix that file, then run ` +
        `\`rowbly --data-root ${root.path} use\` to record it and set its label or default there`,
    );
  }
  if (!known.default) await warnOtherDefault(home, root, opts.warn);
  return { ...result, known };
}

/** Runs `init`; a failure that leaves the Data Root behind says so and how to recover. */
async function finishing(root: DataRoot, init: () => Promise<InitResult>): Promise<InitResult> {
  try {
    return await init();
  } catch (err) {
    if (!(await pathExists(root.path))) throw err;
    throw withHint(
      err,
      `${root.path} was created but setup did not finish; run \`rowbly --data-root ${root.path} doctor\` ` +
        `and finish with \`rowbly --data-root ${root.path} boards create\`, or remove ${root.path} and set it up again`,
    );
  }
}

/** Another default Data Root is opened ahead of a new Data Root (ADR-0033 §1); say so. */
async function warnOtherDefault(home: string, root: DataRoot, warn: (message: string) => void): Promise<void> {
  const path = await canonicalDataRootPath(root.path, home);
  const other = (await listKnownDataRoots(home)).find((known) => known.default && known.path !== path);
  if (!other) return;
  warn(
    `the default Data Root ${other.path} is opened ahead of ${root.path}; pass \`--data-root ${root.path}\` to use it`,
  );
}

/** `err` with `hint`, keeping its class, message and details; any other error unchanged. */
function withHint(err: unknown, hint: string): unknown {
  if (!(err instanceof RowblyError)) return err;
  const Class = err.constructor as new (message: string, options: object) => RowblyError;
  return new Class(err.message, { details: err.details, hint, cause: err });
}
