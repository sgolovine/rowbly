import { readFile } from "node:fs/promises";
import { readConfig } from "../config/config.js";
import { ValidationError } from "../errors/errors.js";
import { writeFileAtomic } from "../files/files.js";
import { lookupStage, unknownStageIssues } from "../stage/stage.js";
import { getStory } from "../story/story.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";
import {
  hasWorkerOverride,
  type OverrideTarget,
  type StageWorkerModels,
  type StoryWorkerModels,
  withWorkerOverride,
} from "./worker-overrides.js";

type AgentAuth = typeof import("../agent-auth/agent-auth.js");
type AuthRuntime = import("../agent-auth/agent-auth.js").AuthRuntime;
type Role = "supervisor" | "worker";

export interface ModelChoice {
  provider: string;
  modelId: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}

export interface FactorySettings {
  version: 1;
  maxWorkers: number;
  supervisorModel?: ModelChoice;
  workerModel?: ModelChoice;
  /** Worker model overrides by Stage key. A Story override has priority. */
  stageWorkerModels?: StageWorkerModels;
  /** Worker model overrides by Story ID, then by Stage key. */
  storyWorkerModels?: StoryWorkerModels;
}

interface ConfigureInput {
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
const DEFAULT_SETTINGS: FactorySettings = { version: 1, maxWorkers: 4 };

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

function validate(value: unknown): FactorySettings {
  const settings = value as FactorySettings;

  if (
    settings?.version !== 1 ||
    !Number.isSafeInteger(settings.maxWorkers) ||
    settings.maxWorkers < 1 ||
    (settings.supervisorModel !== undefined && !validModel(settings.supervisorModel)) ||
    (settings.workerModel !== undefined && !validModel(settings.workerModel)) ||
    !validOverrides(settings)
  ) {
    throw new ValidationError("Invalid factory settings");
  }

  return settings;
}

function readProblem(error: unknown): FactorySettings {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") {
    return { ...DEFAULT_SETTINGS };
  }

  if (error instanceof SyntaxError) {
    throw new ValidationError("Invalid factory settings JSON");
  }

  throw error;
}

/** Reads the factory settings of the Project. Without `factory.json`, the limit is four workers. */
export async function getFactorySettings(ctx: ServiceContext = {}): Promise<FactorySettings> {
  const paths = await findProject(ctx);

  return readFile(paths.factorySettingsFile, "utf8")
    .then((text) => validate(JSON.parse(text)))
    .catch(readProblem);
}

/** Merges the input into the factory settings and writes `factory.json`. */
export async function updateFactorySettings(
  input: Partial<Omit<FactorySettings, "version">>,
  ctx: ServiceContext = {},
): Promise<FactorySettings> {
  const paths = await findProject(ctx);
  const settings = validate({ ...(await getFactorySettings(ctx)), ...input, version: 1 });

  await writeFileAtomic(paths.factorySettingsFile, `${JSON.stringify(settings, null, 2)}\n`);

  return settings;
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

  if (input.supervisor !== undefined || input.supervisorThinking !== undefined || input.maxWorkers !== undefined) {
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

  const config = await readConfig(await findProject(ctx));
  const stage = lookupStage(config, input.stage as string);

  if (!stage) {
    throw new ValidationError("Unknown stage", {
      details: { issues: unknownStageIssues(config, input.stage as string, ["stage"]) },
    });
  }

  const story = input.story === undefined ? undefined : await getStory({ id: input.story }, ctx);

  return { stage: stage.key, storyId: story?.id };
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
      ? updateFactorySettings(withWorkerOverride(settings, target, undefined), ctx)
      : settings;
  }

  const auth = await import("../agent-auth/agent-auth.js");
  const { choice } = await chooseRole(auth, "worker", input, runtime);

  return updateFactorySettings(withWorkerOverride(await getFactorySettings(ctx), target, choice), ctx);
}

/** Validates explicit model choices before the settings file changes. A `stage` sets an override. */
export async function configureFactory(
  input: ConfigureInput,
  ctx: ServiceContext = {},
  runtime?: AuthRuntime,
): Promise<FactorySettings> {
  if (isOverrideInput(input)) {
    return configureWorkerOverride(input, ctx, runtime);
  }

  const auth = await import("../agent-auth/agent-auth.js");

  const supervisor = await chooseRole(auth, "supervisor", input, runtime);
  const worker = await chooseRole(auth, "worker", input, supervisor.runtime);

  return updateFactorySettings(
    {
      ...(input.maxWorkers !== undefined ? { maxWorkers: input.maxWorkers } : {}),
      ...(supervisor.choice ? { supervisorModel: supervisor.choice } : {}),
      ...(worker.choice ? { workerModel: worker.choice } : {}),
    },
    ctx,
  );
}
