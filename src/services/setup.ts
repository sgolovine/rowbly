import { join, resolve } from 'node:path';
import { nanoid } from 'nanoid';
import { ConflictError, isSlug, toTimestamp, ValidationError } from '../core';
import { BoardConfigSchema, type DataRoot, DEFAULT_STAGES, type LocalState, type Slug } from '../schemas';
import { createRepositories, pathExists, type Repositories, writeTextFile } from '../storage';
import { validInput } from './_validate';
import { createServices } from './index';
import type { RowblyContext, SetupService } from './types';

const DATA_ROOT_DIR = '.rowbly';

/**
 * Where `init` creates the Data Root: an explicit `--root` / `ROWBLY_ROOT` path, else `~/.rowbly`
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

/** `init` refuses a target that already exists; callers check it before asking for anything else. */
export async function assertInitTarget(root: DataRoot): Promise<void> {
  if (await pathExists(root.path)) throw new ConflictError(`Data Root already exists: ${root.path}`);
}

/** A `RowblyContext` over a Data Root that may not exist yet, with the real clock and id generator. */
export function newContext(root: DataRoot, warn: (message: string) => void): RowblyContext {
  return { root, local: { version: 1 }, me: null, now: () => new Date(), newId: () => nanoid(8), warn };
}

export type MeSource = 'local' | 'git';

/** Where Me came from: `local.json`, a roster email matching `git config user.email`, or nowhere. */
export function meSource(ctx: RowblyContext): MeSource | null {
  if (ctx.me === null) return null;
  return ctx.local.me === ctx.me ? 'local' : 'git';
}

/**
 * Claims `handle` as Me. Unlike `context.setMe`, a handle missing from the roster only warns, so Me can be set before the roster exists.
 * Lives beside the service because the frozen `ContextService` contract has no such method.
 */
export async function claimMe(ctx: RowblyContext, handle: Slug): Promise<LocalState> {
  if (!isSlug(handle))
    throw new ValidationError(`invalid Assignee handle "${handle}": must be a lower-kebab-case slug`);
  const repos = createRepositories(ctx.root);
  const { me: _me, ...rest } = ctx.local;
  const next: LocalState = { ...rest, me: handle };
  const { assignees } = await repos.rootConfig.get();
  if (!assignees.some((a) => a.handle === handle)) ctx.warn(`"${handle}" is not in the roster`);
  await repos.localState.put(next);
  ctx.local = next;
  ctx.me = handle;
  return next;
}

export function createSetupService(ctx: RowblyContext, _repos: Repositories): SetupService {
  return {
    async init({ root, board }) {
      // Check everything before writing anything, so a bad id never leaves a half-made Data Root.
      const now = toTimestamp(ctx.now());
      if (board) {
        validInput(BoardConfigSchema, 'Board', {
          version: 1,
          ...board,
          keyPrefix: board.keyPrefix.toUpperCase(),
          description: board.description ?? '',
          createdAt: now,
          updatedAt: now,
        });
      }
      await assertInitTarget(root);

      const repos = createRepositories(root);
      await repos.rootConfig.put({
        version: 1,
        assignees: [],
        stages: DEFAULT_STAGES.map((stage) => ({ ...stage })),
      });
      await writeTextFile(join(root.path, '.gitignore'), 'local.json\n');
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
