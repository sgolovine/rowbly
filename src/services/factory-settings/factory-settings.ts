import { type ProjectConfig, readConfig, writeConfig } from "../config/config.js";
import { ConflictError, ValidationError } from "../errors/errors.js";
import { pathExists } from "../files/files.js";
import { lookupStage, unknownStageIssues } from "../stage/stage.js";
import { getStory } from "../story/story.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../workspace/workspace.js";
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
  hasWorkerOverride,
  type OverrideTarget,
  type StageWorkerModels,
  type StoryWorkerModels,
  withWorkerOverride,
} from "./worker-overrides.js";

export type { GitInput, GitSettings, GitSync } from "./git-settings.js";

type AgentAuth = typeof import("../agent-auth/agent-auth.js");
type AuthRuntime = import("../agent-auth/agent-auth.js").AuthRuntime;
type Role = "supervisor" | "worker";

export interface ModelChoice {
  provider: string;
  modelId: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}

/** The `factory` section of `rowbly.config.json`. */
export interface FactorySettings {
  maxWorkers: number;
  supervisorModel?: ModelChoice;
  workerModel?: ModelChoice;
  /** Worker model overrides by Stage key. A Story override has priority. */
  stageWorkerModels?: StageWorkerModels;
  /** Worker model overrides by Story ID, then by Stage key. */
  storyWorkerModels?: StoryWorkerModels;
  git?: GitSettings;
}

/** The changes of an update. The `git` keys merge into the current `git` section. */
export type FactorySettingsInput = Partial<FactorySettings>;

interface ConfigureInput extends GitInput {
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

const THINKING_LEVELS: readonly unknown[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const DEFAULT_SETTINGS: FactorySettings = { maxWorkers: 4 };

/** Tells if a value is a model choice with a provider, a model and an optional known thinking level. */
export function validModel(value: unknown): value is ModelChoice {
  if (!value || typeof value !== "object") {
    return false;
  }

  const model = value as ModelChoice;

  return (
    typeof model.provider === "string" &&
    !!model.provider.trim() &&
    typeof model.modelId === "string" &&
    !!model.modelId.trim() &&
    (model.thinkingLevel === undefined || THINKING_LEVELS.includes(model.thinkingLevel))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validModelMap(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every(validModel);
}

function validOverrides(settings: FactorySettings): boolean {
  const stories = settings.storyWorkerModels;

  return (
    (settings.stageWorkerModels === undefined || validModelMap(settings.stageWorkerModels)) &&
    (stories === undefined || (isRecord(stories) && Object.values(stories).every(validModelMap)))
  );
}

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
    (settings.git === undefined || validGit(settings.git))
  );
}

/** Tells if a value is a valid `factory` section. It does not throw, so `rowbly doctor` can use it. */
export function validFactorySettings(value: unknown): boolean {
  return isRecord(value) && validSettings(withLimit(value));
}

function validate(value: unknown): FactorySettings {
  if (!validFactorySettings(value)) {
    throw new ValidationError("Invalid factory settings", {
      hint: `Use booleans for git.push and git.pull, and ${MIN_SYNC_SECONDS} to ${MAX_SYNC_SECONDS} for git.syncIntervalSeconds`,
    });
  }

  return withLimit(value as Record<string, unknown>);
}

/** Fills the absent Git sync keys with their defaults. The other `git` keys stay. */
function withDefaults(settings: FactorySettings): FactorySettings {
  return { ...settings, git: { ...settings.git, ...gitSync(settings.git) } };
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
 * Stops a factory start while an old `factory.json` exists, because the factory does not read it. It does not parse
 * the file: `rowbly doctor` checks it.
 */
export async function assertNoLegacyFactorySettings(paths: ProjectPaths): Promise<void> {
  if (await pathExists(paths.legacyFactorySettingsFile)) {
    throw new ConflictError("The factory does not read .rowbly/factory.json", {
      hint: "Run rowbly doctor --fix to move factory.json into rowbly.config.json, then start the factory again.",
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
 * section of the config. The other config keys stay. The defaults are not written.
 */
async function writeSettings(
  change: (current: FactorySettings) => FactorySettings,
  ctx: ServiceContext,
): Promise<FactorySettings> {
  const paths = await findProject(ctx);
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

/** Parses `provider/model`. The provider and the model must not be empty. */
function parseChoice(value: string, thinkingLevel: ModelChoice["thinkingLevel"]): ModelChoice {
  const slash = value.indexOf("/");

  if (slash < 1 || slash === value.length - 1) {
    throw new ValidationError("Use provider/model for a model choice");
  }

  const choice = { provider: value.slice(0, slash), modelId: value.slice(slash + 1), thinkingLevel };

  if (!validModel(choice)) {
    throw new ValidationError("Invalid model choice");
  }

  return choice;
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

function isOverrideInput(input: ConfigureInput): boolean {
  return input.stage !== undefined || input.story !== undefined || !!input.clearWorker;
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
    hasGitInput(input)
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

/** Checks the Stage key and the Story ID of an override target, and gives their canonical keys. */
async function checkedTarget(target: OverrideTarget, ctx: ServiceContext): Promise<OverrideTarget> {
  const config = await readConfig(await findProject(ctx));
  const stage = lookupStage(config, target.stage);

  if (!stage) {
    throw new ValidationError("Unknown stage", {
      details: { issues: unknownStageIssues(config, target.stage, ["stage"]) },
    });
  }

  const story = target.storyId === undefined ? undefined : await getStory({ id: target.storyId }, ctx);

  return { stage: stage.key, storyId: story?.id };
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

/** Rejects an invalid commit author before the runtime starts. */
function checkGitInput(input: ConfigureInput): void {
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
  if (isOverrideInput(input)) {
    return configureWorkerOverride(input, ctx, runtime);
  }

  checkGitInput(input);

  const auth = await import("../agent-auth/agent-auth.js");
  const supervisor = await chooseRole(auth, "supervisor", input, runtime);
  const worker = await chooseRole(auth, "worker", input, supervisor.runtime);

  return writeSettings(
    (current) => ({
      ...current,
      ...(input.maxWorkers !== undefined ? { maxWorkers: input.maxWorkers } : {}),
      ...(supervisor.choice ? { supervisorModel: supervisor.choice } : {}),
      ...(worker.choice ? { workerModel: worker.choice } : {}),
      ...(hasGitInput(input) ? { git: mergeGit(current.git, input) } : {}),
    }),
    ctx,
  );
}
