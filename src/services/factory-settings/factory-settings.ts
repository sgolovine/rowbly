import { type ProjectConfig, readConfig, writeConfig } from "../config/config.js";
import { ConflictError, ValidationError } from "../errors/errors.js";
import { pathExists } from "../files/files.js";
import { refuseRemoteWrite } from "../outbox/outbox.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../workspace/workspace.js";
import {
  assertChecks,
  type CheckInput,
  type CheckSettings,
  checkLimits,
  hasCheckInput,
  mergeChecks,
  validChecks,
} from "./check-settings.js";
import { type Dependencies, type DependencyInput, dependencyChange, validDependencies } from "./dependency-settings.js";
import {
  checkFallbackInput,
  chooseFallbacks,
  type FallbackInput,
  fallbackChange,
  hasFallbackInput,
} from "./fallback-workers.js";
import {
  type GitInput,
  type GitSettings,
  type GitSync,
  gitSync,
  hasGitInput,
  MAX_SYNC_SECONDS,
  MIN_SYNC_SECONDS,
  mergeGit,
  parseAuthor,
  validGit,
} from "./git-settings.js";
import {
  isRecord,
  type ModelChoice,
  parseChoice,
  validFallbacks,
  validModel,
  validOverrides,
} from "./model-settings.js";
import {
  DEFAULT_PLACEMENT,
  type PlacementInput,
  type PlacementPolicy,
  placementChange,
  validPlacement,
} from "./placement-settings.js";
import {
  hasStageClassInput,
  type StageClasses,
  type StageClassInput,
  stageClassChoice,
  stageClassProblem,
  validStageClasses,
  withStageClass,
} from "./stage-classes.js";
import {
  checkedTarget,
  hasWorkerOverride,
  isOverrideInput,
  type OverrideTarget,
  type StageWorkerModels,
  type StoryWorkerModels,
  withWorkerOverride,
} from "./worker-overrides.js";

export type { CheckItem, CheckSpec } from "./check-settings.js";
export { pullUpstream } from "./dependency-settings.js";
export type { GitInput, GitSync } from "./git-settings.js";
export { type ModelChoice, validModel } from "./model-settings.js";

type AgentAuth = typeof import("../agent-auth/agent-auth.js");
type AuthRuntime = import("../agent-auth/agent-auth.js").AuthRuntime;
type Role = "supervisor" | "worker";

/** The `factory` section of `rowbly.config.json`. */
export interface FactorySettings {
  maxWorkers: number;
  supervisorModel?: ModelChoice;
  workerModel?: ModelChoice;
  /** Worker model overrides by Stage key. A Story override has priority. */
  stageWorkerModels?: StageWorkerModels;
  /** Worker model overrides by Story ID, then by Stage key. */
  storyWorkerModels?: StoryWorkerModels;
  /** The worker models, in order, that the manager uses when the provider of the selected model is paused. */
  fallbackWorkerModels?: readonly ModelChoice[];
  git?: GitSettings;
  checks?: CheckSettings;
  dependencies?: Dependencies;
  /** How the manager selects the machine of a new worker. The default is `prefer-local`. */
  placement?: PlacementPolicy;
  /** The class of each Stage, by Stage key. It has priority over the rule of the manager. */
  stageClasses?: StageClasses;
}

/** The changes of an update. The `git` keys merge into the current `git` section. */
export type FactorySettingsInput = Partial<FactorySettings>;

interface ConfigureInput extends GitInput, CheckInput, DependencyInput, PlacementInput, FallbackInput, StageClassInput {
  maxWorkers?: number;
  supervisor?: string;
  worker?: string;
  supervisorThinking?: ModelChoice["thinkingLevel"];
  workerThinking?: ModelChoice["thinkingLevel"];
  /** With `stage`, the worker model is an override for the Stage, or for the Story in the Stage. */
  stage?: string;
  story?: string;
  clearWorker?: boolean;
}

/** The model choice of one role, and the runtime that the next role can use again. */
interface RoleChoice {
  readonly runtime?: AuthRuntime;
  readonly choice?: ModelChoice;
}

const DEFAULT_SETTINGS: FactorySettings = { maxWorkers: 4 };

/** Gives the stored section with the default limit of four workers when `maxWorkers` is absent. */
function withLimit(section: Record<string, unknown>): FactorySettings {
  return { ...DEFAULT_SETTINGS, ...section } as FactorySettings;
}

function validSettings(settings: FactorySettings): boolean {
  return (
    Number.isSafeInteger(settings.maxWorkers) &&
    settings.maxWorkers >= 1 &&
    (settings.supervisorModel === undefined || validModel(settings.supervisorModel)) &&
    (settings.workerModel === undefined || validModel(settings.workerModel)) &&
    validOverrides(settings) &&
    validFallbacks(settings.fallbackWorkerModels) &&
    (settings.git === undefined || validGit(settings.git)) &&
    (settings.checks === undefined || validChecks(settings.checks)) &&
    validDependencies(settings.dependencies) &&
    validPlacement(settings.placement) &&
    validStageClasses(settings.stageClasses)
  );
}

/** Tells if a value is a valid `factory` section. It does not throw, so `rowbly doctor` can use it. */
export function validFactorySettings(value: unknown): boolean {
  return isRecord(value) && validSettings(withLimit(value));
}

function validate(value: unknown): FactorySettings {
  assertChecks(isRecord(value) ? value.checks : undefined);

  if (!validFactorySettings(value)) {
    throw new ValidationError("Invalid factory settings", {
      hint: `Use booleans for git.push and git.pull, ${MIN_SYNC_SECONDS} to ${MAX_SYNC_SECONDS} for git.syncIntervalSeconds, and work or hold for stageClasses`,
    });
  }

  return withLimit(value as Record<string, unknown>);
}

/** Fills the absent Git sync keys and the absent placement policy with their defaults. The other `git` keys stay. */
function withDefaults(settings: FactorySettings): FactorySettings {
  const checks = checkLimits(settings.checks);
  const placement = settings.placement ?? DEFAULT_PLACEMENT;

  return { ...settings, git: { ...settings.git, ...gitSync(settings.git) }, ...(checks ? { checks } : {}), placement };
}

/** Gives the Git sync settings. Settings without a `git` section use the defaults. */
export function gitSettings(settings: FactorySettings): GitSync {
  return gitSync(settings.git);
}

/** Gives the `factory` section of the config as it is on disk. Without the section, the limit is four workers. */
function storedSettings(config: ProjectConfig): FactorySettings {
  return config.factory === undefined ? { ...DEFAULT_SETTINGS } : validate(config.factory);
}

/**
 * Stops a factory start and a settings write while an old `factory.json` exists, because Rowbly does not read it. A
 * write before the move makes a `factory` section that `rowbly doctor` cannot merge. It does not parse the file:
 * `rowbly doctor` checks it.
 */
export async function assertNoLegacyFactorySettings(paths: ProjectPaths): Promise<void> {
  if (await pathExists(paths.legacyFactorySettingsFile)) {
    throw new ConflictError("Rowbly does not read .rowbly/factory.json", {
      hint: "Run rowbly doctor --fix to move factory.json into rowbly.config.json, then do the operation again.",
    });
  }
}

/**
 * Reads the factory settings of the Project. Without a `factory` section in the config, the limit is four workers.
 * The absent Git sync keys have their defaults: push and pull are off, and the interval is 300 seconds.
 */
export async function getFactorySettings(ctx: ServiceContext = {}): Promise<FactorySettings> {
  const paths = await findProject(ctx);

  return withDefaults(storedSettings(await readConfig(paths)));
}

/**
 * Validates the settings that `change` makes from the settings on disk, and writes them to the `factory`
 * section of the config. The other config keys stay. The absent Git sync keys are not written, but `maxWorkers`
 * is always written. While an old `factory.json` exists, it gives a `ConflictError` and changes nothing.
 */
export async function writeSettings(
  change: (current: FactorySettings) => FactorySettings,
  ctx: ServiceContext,
): Promise<FactorySettings> {
  refuseRemoteWrite(ctx, "change the factory settings");

  const paths = await findProject(ctx);

  await assertNoLegacyFactorySettings(paths);

  const config = await readConfig(paths);
  const settings = validate(change(storedSettings(config)));

  await writeConfig(paths, { ...config, factory: { ...settings } });

  return withDefaults(settings);
}

/** Merges the input into the factory settings and writes them to the config. The `git` keys merge one level deep. */
export async function updateFactorySettings(
  input: FactorySettingsInput,
  ctx: ServiceContext = {},
): Promise<FactorySettings> {
  return writeSettings(
    (current) => ({ ...current, ...input, ...(input.git ? { git: { ...current.git, ...input.git } } : {}) }),
    ctx,
  );
}

/** Validates the model of one role. The runtime starts only for the first role with a model. */
async function chooseRole(
  auth: AgentAuth,
  role: Role,
  input: ConfigureInput,
  runtime?: AuthRuntime,
): Promise<RoleChoice> {
  const value = input[role];
  const thinkingLevel = input[`${role}Thinking`];

  if (!value && thinkingLevel) {
    throw new ValidationError(`Select the ${role} model with its thinking level`);
  }

  if (!value) {
    return { runtime };
  }

  const choice = parseChoice(value, thinkingLevel);
  const resolved = runtime ?? (await auth.authRuntime());

  return { runtime: resolved, choice: await auth.validateModelChoice(resolved, choice) };
}

/** Gives the first rule that the flags of an override break. */
function overrideProblem(input: ConfigureInput): string | undefined {
  if (input.stage === undefined) {
    return input.clearWorker
      ? "Select the Stage of the worker model to clear"
      : "Select the Stage of the Story override";
  }

  if (
    input.supervisor !== undefined ||
    input.supervisorThinking !== undefined ||
    input.maxWorkers !== undefined ||
    hasGitInput(input) ||
    hasCheckInput(input) ||
    input.pullUpstream !== undefined ||
    input.placement !== undefined ||
    hasFallbackInput(input)
  ) {
    return "A Stage override sets only the worker model";
  }

  if (input.clearWorker && (input.worker !== undefined || input.workerThinking !== undefined)) {
    return "Do not select a worker model when you clear it";
  }

  return !input.clearWorker && input.worker === undefined ? "Select the worker model or clear it" : undefined;
}

/** Checks the flags, the Stage key and the Story ID of an override, and gives their canonical keys. */
async function overrideTarget(input: ConfigureInput, ctx: ServiceContext): Promise<OverrideTarget> {
  const problem = overrideProblem(input);

  if (problem) {
    throw new ValidationError(problem);
  }

  return checkedTarget({ stage: input.stage as string, storyId: input.story }, ctx);
}

/**
 * Sets the worker model override of a Stage, or of a Story in a Stage, to a model that was already selected.
 * Without a choice, it removes the override. An empty map is not kept, and the other keys do not change.
 */
export async function setWorkerOverride(
  target: OverrideTarget,
  choice: ModelChoice | undefined,
  ctx: ServiceContext = {},
): Promise<FactorySettings> {
  const checked = await checkedTarget(target, ctx);

  if (choice !== undefined && !validModel(choice)) {
    throw new ValidationError("Invalid model choice");
  }

  return writeSettings((current) => ({ ...current, ...withWorkerOverride(current, checked, choice) }), ctx);
}

/** Sets or clears the worker model override of a Stage, or of a Story in a Stage. */
async function configureWorkerOverride(
  input: ConfigureInput,
  ctx: ServiceContext = {},
  runtime?: AuthRuntime,
): Promise<FactorySettings> {
  const target = await overrideTarget(input, ctx);

  if (input.clearWorker) {
    const settings = await getFactorySettings(ctx);

    return hasWorkerOverride(settings, target)
      ? writeSettings((current) => ({ ...current, ...withWorkerOverride(current, target, undefined) }), ctx)
      : settings;
  }

  const auth = await import("../agent-auth/agent-auth.js");
  const { choice } = await chooseRole(auth, "worker", input, runtime);

  return writeSettings((current) => ({ ...current, ...withWorkerOverride(current, target, choice) }), ctx);
}

/** Sets or clears the class of a Stage. The flags and the Stage key are checked before the config changes. */
async function configureStageClass(input: ConfigureInput, ctx: ServiceContext): Promise<FactorySettings> {
  const problem = stageClassProblem(input);

  if (problem) {
    throw new ValidationError(problem);
  }

  const stageClass = stageClassChoice(input);
  const { stage } = await checkedTarget({ stage: input.stage as string }, ctx);

  return writeSettings((current) => ({ ...current, ...withStageClass(current.stageClasses, stage, stageClass) }), ctx);
}

/** Rejects an invalid commit author, dependency value or placement policy before the runtime starts. */
function checkGitInput(input: ConfigureInput): void {
  dependencyChange(undefined, input);
  placementChange(input);

  if (input.commitAuthor?.trim()) {
    parseAuthor(input.commitAuthor);
  }
}

/**
 * Applies only Git values to the factory settings. It does not load `agent-auth` or Pi, so the TUI can use it
 * without the auth runtime. An invalid author or sync interval fails before the config changes.
 */
export async function configureGit(input: GitInput, ctx: ServiceContext = {}): Promise<FactorySettings> {
  checkGitInput(input);

  return writeSettings((current) => ({ ...current, git: mergeGit(current.git, input) }), ctx);
}

/** Validates explicit model choices and Git values before the config changes. A `stage` sets an override. */
export async function configureFactory(
  input: ConfigureInput,
  ctx: ServiceContext = {},
  runtime?: AuthRuntime,
): Promise<FactorySettings> {
  refuseRemoteWrite(ctx, "change the factory settings");

  if (hasStageClassInput(input)) {
    return configureStageClass(input, ctx);
  }

  if (isOverrideInput(input)) {
    return configureWorkerOverride(input, ctx, runtime);
  }

  checkGitInput(input);
  checkFallbackInput(input);

  const auth = await import("../agent-auth/agent-auth.js");
  const supervisor = await chooseRole(auth, "supervisor", input, runtime);
  const worker = await chooseRole(auth, "worker", input, supervisor.runtime);
  const fallbacks = await chooseFallbacks(auth, input, worker.runtime);

  return writeSettings(
    (current) => ({
      ...current,
      ...(input.maxWorkers !== undefined ? { maxWorkers: input.maxWorkers } : {}),
      ...(supervisor.choice ? { supervisorModel: supervisor.choice } : {}),
      ...(worker.choice ? { workerModel: worker.choice } : {}),
      ...(hasGitInput(input) ? { git: mergeGit(current.git, input) } : {}),
      ...(hasCheckInput(input) ? { checks: mergeChecks(current.checks, input) } : {}),
      ...dependencyChange(current.dependencies, input),
      ...placementChange(input),
      ...fallbackChange(input, fallbacks.choices),
    }),
    ctx,
  );
}
