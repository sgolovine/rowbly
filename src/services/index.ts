import { nanoid } from 'nanoid';
import { createRepositories, findDataRoot, gitUserEmail } from '../storage';
import { createAssigneesService } from './assignees';
import { createBoardsService } from './boards';
import { createConfigService } from './config';
import { createContextService } from './context';
import { createDoctorService } from './doctor';
import { createFieldsService } from './fields';
import type { PluginHost } from './plugins/host';
import { createOperationRunner } from './plugins/runtime';
import { createPluginsService } from './plugins/service';
import { createSetupService } from './setup';
import { createStagesService } from './stages';
import { createStoriesService } from './stories';
import { createTasksService } from './tasks';
import type { RowblyContext, Services } from './types';

export {
  type ActivePlugin,
  failureWarning,
  type LoadPluginsOptions,
  loadPlugins,
  onOff,
  type PluginHost,
  type PluginStatus,
  type ReservedNames,
} from './plugins/host';
export { pluginStoryRows, pluginTaskRows } from './plugins/service';
export type * from './plugins/types';
export type * from './types';

/**
 * All services over one context. Repositories (and their caches) are shared for its lifetime. Every
 * operation runs through the Plugin pipeline of `ctx.plugins` (ADR-0012).
 */
export function createServices(ctx: RowblyContext): Services {
  const repos = createRepositories(ctx.root);
  const ops = createOperationRunner(ctx, repos, () => services);
  const services: Services = {
    context: createContextService(ctx, repos, ops),
    setup: createSetupService(ctx, repos),
    config: createConfigService(ctx, repos),
    assignees: createAssigneesService(ctx, repos, ops),
    boards: createBoardsService(ctx, repos, ops),
    stages: createStagesService(ctx, repos, ops),
    fields: createFieldsService(ctx, repos, ops),
    stories: createStoriesService(ctx, repos, ops),
    tasks: createTasksService(ctx, repos, ops),
    doctor: createDoctorService(ctx, repos, ops),
    plugins: createPluginsService(ctx, repos, ops),
  };
  return services;
}

export interface CreateContextOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  home: string;
  /** `--root`. */
  root?: string;
  warn(message: string): void;
  /** The Plugins loaded for this Data Root. */
  plugins?: PluginHost;
  /** Do not wait for reactions (the TUI). */
  backgroundReactions?: boolean;
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
    ...(opts.plugins ? { plugins: opts.plugins } : {}),
    ...(opts.backgroundReactions ? { backgroundReactions: true } : {}),
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
