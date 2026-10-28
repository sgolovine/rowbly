import { customAlphabet } from 'nanoid';
import { createRepositories, findDataRoot, recordOpenedDataRoot } from '../storage';
import { createBoardsService } from './boards';
import { createConfigService } from './config';
import { createContextService } from './context';
import { coordinated, coordinatedRepositories, coordinatedServices, mutationCoordinator } from './coordination';
import { createDoctorService } from './doctor';
import { createFeatureFlagsService } from './featureFlags';
import { createFieldsService } from './fields';
import { effectiveMe, readGlobalMe } from './identity';
import type { PluginHost } from './plugins/host';
import { createOperationRunner } from './plugins/runtime';
import { createPluginsService } from './plugins/service';
import { createSetupService } from './setup';
import { createStagesService } from './stages';
import { createStoriesService } from './stories';
import type { RowblyContext, Services } from './types';

/**
 * Generated ids (for example Comment ids) use letters and digits only. nanoid's default alphabet
 * includes `-` and `_`, and an id starting with `-` is read as a flag on the command line.
 */
export const newId = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 8);

export { coordinated, type RecoveryOutcome, withMutation, withRecovery } from './coordination';
export {
  type KnownDataRootChoice,
  knownDataRoots,
  openKnownDataRoot,
  removeKnownDataRoot,
  updateKnownDataRoot,
} from './dataRoots';
export {
  applyGlobalMe,
  effectiveMe,
  type Identity,
  identity,
  type MeSource,
  readGlobalMe,
  setGlobalMe,
} from './identity';
export { pluginReadServices, pluginServices } from './plugins/capabilities';
export {
  type ActivePlugin,
  failureWarning,
  type LoadPluginsOptions,
  loadPlugins,
  onOff,
  type PluginDiagnostic,
  type PluginHost,
  type PluginStatus,
  type ReservedNames,
  validatePluginDefinition,
} from './plugins/host';
export { attribute as attributePluginError, type Invocation, invokePlugin, invokePluginSync } from './plugins/invoke';
export { pluginStoryRows } from './plugins/service';
export {
  formatTrace,
  setTraceSink,
  type TraceEvent,
  type TraceSink,
  traceBuffer,
  traceRequested,
} from './plugins/trace';
export type * from './plugins/types';
export { CORE_OPERATION_NAMES, PLUGIN_OPTION_COMMANDS } from './plugins/types';
export { readOpenStoryAfterCreation, setOpenStoryAfterCreation } from './preferences';
export {
  type CreateSkillInput,
  createSkill,
  HARNESS_FOLDERS,
  HARNESSES,
  type Harness,
  type InstalledSkill,
  type InstallSkillInput,
  installSkill,
  invalidSkillName,
  listAllSkills,
  listSkills,
  type OfficialSkill,
  officialSkills,
  type SkillEntry,
  type SkillList,
} from './skills';
export type * from './types';

/**
 * All services over one context. Repositories (and their caches) are shared for its lifetime. Every
 * operation runs through the Plugin pipeline of `ctx.plugins` (ADR-0012).
 */
export function createServices(ctx: RowblyContext): Services {
  ctx.plugins?.setWarningSink?.(ctx.warn);
  const repos = coordinatedRepositories(ctx.root, createRepositories(ctx.root));
  const ops = createOperationRunner(ctx, repos, () => services, mutationCoordinator(ctx.root));
  // Every service call holds the Data Root lock from its first read; an operation inside it reuses
  // the lock and gives it up before its reactions (ADR-0019 §1, §5).
  const each = <S extends object>(area: string, service: S, except: readonly string[] = []) =>
    coordinatedServices(ctx.root, area, service, except);
  const services: Services = {
    context: each('context', createContextService(ctx, repos, ops)),
    // `init` creates a Data Root that does not exist yet: nothing to coordinate with.
    setup: createSetupService(ctx, repos),
    config: each('config', createConfigService(ctx, repos, ops)),
    featureFlags: each('featureFlags', createFeatureFlagsService(repos, ops)),
    boards: each('boards', createBoardsService(ctx, repos, ops)),
    stages: each('stages', createStagesService(ctx, repos, ops)),
    fields: each('fields', createFieldsService(ctx, repos, ops)),
    stories: each('stories', createStoriesService(ctx, repos, ops)),
    // Doctor takes the lock itself, so that it can report a transaction recovery cannot finish.
    doctor: createDoctorService(ctx, repos, ops),
    // `context(id)` only builds the Plugin's context; its reads and operations coordinate themselves.
    plugins: each('plugins', createPluginsService(ctx, repos, ops), ['context']),
  };
  return services;
}

export interface CreateContextOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  home: string;
  /** `--data-root`. */
  root?: string;
  warn(message: string): void;
  /** The Plugins loaded for this Data Root. */
  plugins?: PluginHost;
  /** Do not wait for reactions (the TUI). */
  backgroundReactions?: boolean;
}

/**
 * Resolves the Data Root, Local State and Me (contracts §4) and builds a `RowblyContext` with the
 * real clock and id generator. Shared by the Command Layer and the TUI. Me is the local Me, else
 * global Me from the Home Config (ADR-0032); a Home Config that cannot be read throws.
 */
export async function createContext(opts: CreateContextOptions): Promise<RowblyContext> {
  const root = await findDataRoot({ cwd: opts.cwd, flag: opts.root, env: opts.env, home: opts.home });
  // Opening the Data Root finishes any interrupted commit before the first read (ADR-0019 §2).
  const local = await coordinated(root, 'open', () => createRepositories(root).localState.get());
  // Every Data Root opened is a known Data Root (ADR-0033 §2); a Home Config that cannot take it
  // only warns, since the command does not need it.
  await recordOpenedDataRoot(opts.home, root).catch((err: unknown) =>
    opts.warn(`Data Root not recorded in the Home Config: ${err instanceof Error ? err.message : String(err)}`),
  );
  // A Home Config that cannot be read fails the command rather than drop global Me, which would
  // change who Rowbly records as the creator or author (ADR-0032 §2).
  const globalMe = await readGlobalMe(opts.home);
  const ctx: RowblyContext = {
    root,
    local,
    me: effectiveMe(local, globalMe),
    globalMe,
    home: opts.home,
    now: () => new Date(),
    newId,
    warn: opts.warn,
    ...(opts.plugins ? { plugins: opts.plugins } : {}),
    ...(opts.backgroundReactions ? { backgroundReactions: true } : {}),
  };
  return ctx;
}
