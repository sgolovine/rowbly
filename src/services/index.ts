import { nanoid } from 'nanoid';
import { createRepositories, findDataRoot, gitUserEmail } from '../storage';
import { createAssigneesService } from './assignees';
import { createBoardsService } from './boards';
import { createCommentsService } from './comments';
import { createConfigService } from './config';
import { createContextService } from './context';
import { createDoctorService } from './doctor';
import { createFieldsService } from './fields';
import { createSetupService } from './setup';
import { createStagesService } from './stages';
import { createStoriesService } from './stories';
import { createTasksService } from './tasks';
import type { RowblyContext, Services } from './types';

export type * from './types';

/** All services over one context. Repositories (and their caches) are shared for its lifetime. */
export function createServices(ctx: RowblyContext): Services {
  const repos = createRepositories(ctx.root);
  return {
    context: createContextService(ctx, repos),
    setup: createSetupService(ctx, repos),
    config: createConfigService(ctx, repos),
    assignees: createAssigneesService(ctx, repos),
    boards: createBoardsService(ctx, repos),
    stages: createStagesService(ctx, repos),
    fields: createFieldsService(ctx, repos),
    stories: createStoriesService(ctx, repos),
    tasks: createTasksService(ctx, repos),
    comments: createCommentsService(ctx, repos),
    doctor: createDoctorService(ctx, repos),
  };
}

export interface CreateContextOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  home: string;
  /** `--root`. */
  root?: string;
  warn(message: string): void;
}

/**
 * Resolves the Data Root, Local State and Me (contracts §4) and builds a `RowblyContext` with the
 * real clock and id generator. Shared by the Command Layer and the TUI.
 */
export async function createContext(opts: CreateContextOptions): Promise<RowblyContext> {
  const root = await findDataRoot({ cwd: opts.cwd, flag: opts.root, env: opts.env, home: opts.home });
  const local = await createRepositories(root).localState.get();
  const ctx: RowblyContext = {
    root,
    local,
    me: local.me ?? null,
    now: () => new Date(),
    newId: () => nanoid(8),
    warn: opts.warn,
  };
  if (ctx.me === null) ctx.me = await meFromGitEmail(ctx, opts);
  return ctx;
}

/** The handle of the roster entry whose email equals `git config user.email`, if any. */
async function meFromGitEmail(ctx: RowblyContext, opts: CreateContextOptions): Promise<string | null> {
  const email = await gitUserEmail(opts.cwd);
  if (!email) return null;
  try {
    const { assignees } = await createRepositories(ctx.root).rootConfig.get();
    return assignees.find((a) => a.email?.toLowerCase() === email.toLowerCase())?.handle ?? null;
  } catch {
    // An unreadable root config means no roster to match against.
    return null;
  }
}
