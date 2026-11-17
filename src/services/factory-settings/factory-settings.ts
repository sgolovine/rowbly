import { ValidationError } from "../errors/errors.js";
import { refuseRemoteWrite } from "../outbox/outbox.js";
import type { ServiceContext } from "../workspace/workspace.js";
import { type CheckInput, type CheckSettings, hasCheckInput, mergeChecks } from "./check-settings.js";
import { type Dependencies, type DependencyInput, dependencyChange } from "./dependency-settings.js";
import {
  checkFallbackInput,
  chooseFallbacks,
  type FallbackInput,
  fallbackChange,
  hasFallbackInput,
} from "./fallback-workers.js";
import { type GitInput, type GitSettings, hasGitInput, mergeGit, parseAuthor } from "./git-settings.js";
import { type ModelChoice, parseChoice, validModel } from "./model-settings.js";
import { type PlacementInput, type PlacementPolicy, placementChange } from "./placement-settings.js";
import { getFactorySettings, writeSettings } from "./settings-file.js";
import {
  hasStageClassInput,
  type StageClasses,
  type StageClassInput,
  stageClassChoice,
  stageClassProblem,
  withStageClass,
} from "./stage-classes.js";
import { checkedTagKey, hasTagInput, hasTagWorker, tagWorkerProblem, withTagWorker } from "./tag-workers.js";
import {
  checkedTarget,
  hasWorkerOverride,
  isOverrideInput,
  type OverrideTarget,
  type StageWorkerModels,
  type StoryWorkerModels,
  type TagWorkerModels,
  withWorkerOverride,
} from "./worker-overrides.js";

export type { CheckItem, CheckSpec } from "./check-settings.js";
export { pullUpstream } from "./dependency-settings.js";
export type { GitInput, GitSync } from "./git-settings.js";
export { type ModelChoice, validModel } from "./model-settings.js";
export {
  assertNoLegacyFactorySettings,
  getFactorySettings,
  gitSettings,
  updateFactorySettings,
  validFactorySettings,
  writeSettings,
} from "./settings-file.js";

type AgentAuth = typeof import("../agent-auth/agent-auth.js");
type AuthRuntime = import("../agent-auth/agent-auth.js").AuthRuntime;

/** The `factory` section of `rowbly.config.json`. */
export interface FactorySettings {
  maxWorkers: number;
  workerModel?: ModelChoice;
  /** Worker model overrides by Stage key. A Story override has priority. */
  stageWorkerModels?: StageWorkerModels;
  /** Worker model overrides by Story ID, then by Stage key. */
  storyWorkerModels?: StoryWorkerModels;
  /** Worker model rules by tag value, in all Stages. A Story override has priority, and a Stage override comes after. */
  tagWorkerModels?: TagWorkerModels;
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
  worker?: string;
  workerThinking?: ModelChoice["thinkingLevel"];
  /** With `stage`, the worker model is an override for the Stage, or for the Story in the Stage. */
  stage?: string;
  story?: string;
  /** Without `stage`, the worker model is the rule of the Stories with this tag. */
  tag?: string;
  clearWorker?: boolean;
}

/** The worker model choice, and the runtime that the fallback models can use again. */
interface RoleChoice {
  readonly runtime?: AuthRuntime;
  readonly choice?: ModelChoice;
}

/** Validates the worker model. The runtime starts only when the input has a worker model. */
async function chooseWorker(auth: AgentAuth, input: ConfigureInput, runtime?: AuthRuntime): Promise<RoleChoice> {
  const value = input.worker;
  const thinkingLevel = input.workerThinking;

  if (!value && thinkingLevel) {
    throw new ValidationError("Select the worker model with its thinking level");
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
  const { choice } = await chooseWorker(auth, input, runtime);

  return writeSettings((current) => ({ ...current, ...withWorkerOverride(current, target, choice) }), ctx);
}

/** Sets or clears the worker model rule of a tag. The flags and the tag are checked before the config changes. */
async function configureTagWorker(
  input: ConfigureInput,
  ctx: ServiceContext,
  runtime?: AuthRuntime,
): Promise<FactorySettings> {
  const problem = tagWorkerProblem(input);

  if (problem) {
    throw new ValidationError(problem);
  }

  const tag = await checkedTagKey(input.tag as string, !!input.clearWorker, ctx);

  if (input.clearWorker) {
    const settings = await getFactorySettings(ctx);

    return hasTagWorker(settings, tag)
      ? writeSettings((current) => ({ ...current, ...withTagWorker(current, tag, undefined) }), ctx)
      : settings;
  }

  const auth = await import("../agent-auth/agent-auth.js");
  const { choice } = await chooseWorker(auth, input, runtime);

  return writeSettings((current) => ({ ...current, ...withTagWorker(current, tag, choice) }), ctx);
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

  if (hasTagInput(input)) {
    return configureTagWorker(input, ctx, runtime);
  }

  if (hasStageClassInput(input)) {
    return configureStageClass(input, ctx);
  }

  if (isOverrideInput(input)) {
    return configureWorkerOverride(input, ctx, runtime);
  }

  checkGitInput(input);
  checkFallbackInput(input);

  const auth = await import("../agent-auth/agent-auth.js");
  const worker = await chooseWorker(auth, input, runtime);
  const fallbacks = await chooseFallbacks(auth, input, worker.runtime);

  return writeSettings(
    (current) => ({
      ...current,
      ...(input.maxWorkers !== undefined ? { maxWorkers: input.maxWorkers } : {}),
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
