import { readFile } from "node:fs/promises";
import { ValidationError } from "../errors/errors.js";
import { writeFileAtomic } from "../files/files.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";
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

export type { GitSettings, GitSync } from "./git-settings.js";

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
  git?: GitSettings;
}

/** The changes of an update. The `git` keys merge into the current `git` section. */
export type FactorySettingsInput = Partial<Omit<FactorySettings, "version">>;

interface ConfigureInput extends GitInput {
  maxWorkers?: number;
  supervisor?: string;
  worker?: string;
  supervisorThinking?: ModelChoice["thinkingLevel"];
  workerThinking?: ModelChoice["thinkingLevel"];
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

function validate(value: unknown): FactorySettings {
  const settings = value as FactorySettings;

  if (
    settings?.version !== 1 ||
    !Number.isSafeInteger(settings.maxWorkers) ||
    settings.maxWorkers < 1 ||
    (settings.supervisorModel !== undefined && !validModel(settings.supervisorModel)) ||
    (settings.workerModel !== undefined && !validModel(settings.workerModel)) ||
    (settings.git !== undefined && !validGit(settings.git))
  ) {
    throw new ValidationError("Invalid factory settings", {
      hint: `Use booleans for git.push and git.pull, and ${MIN_SYNC_SECONDS} to ${MAX_SYNC_SECONDS} for git.syncIntervalSeconds`,
    });
  }

  return settings;
}

/** Fills the absent Git sync keys with their defaults. The other `git` keys stay. */
function withDefaults(settings: FactorySettings): FactorySettings {
  return { ...settings, git: { ...settings.git, ...gitSync(settings.git) } };
}

/** Gives the Git sync settings. Settings without a `git` section use the defaults. */
export function gitSettings(settings: FactorySettings): GitSync {
  return gitSync(settings.git);
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

/** Reads `factory.json` as it is on disk. Without the file, the limit is four workers. */
async function readSettings(file: string): Promise<FactorySettings> {
  return readFile(file, "utf8")
    .then((text) => validate(JSON.parse(text)))
    .catch(readProblem);
}

/**
 * Reads the factory settings of the Project. Without `factory.json`, the limit is four workers.
 * The absent Git sync keys have their defaults: push and pull are off, and the interval is 300 seconds.
 */
export async function getFactorySettings(ctx: ServiceContext = {}): Promise<FactorySettings> {
  const paths = await findProject(ctx);

  return withDefaults(await readSettings(paths.factorySettingsFile));
}

/** Validates and writes the settings that `change` makes from the settings on disk. The defaults are not written. */
async function writeSettings(
  change: (current: FactorySettings) => FactorySettings,
  ctx: ServiceContext,
): Promise<FactorySettings> {
  const paths = await findProject(ctx);
  const current = await readSettings(paths.factorySettingsFile);
  const settings = validate({ ...change(current), version: 1 });

  await writeFileAtomic(paths.factorySettingsFile, `${JSON.stringify(settings, null, 2)}\n`);

  return withDefaults(settings);
}

/** Merges the input into the factory settings and writes `factory.json`. The `git` keys merge one level deep. */
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

/** Rejects an invalid commit author before the runtime starts. */
function checkGitInput(input: ConfigureInput): void {
  if (input.commitAuthor?.trim()) {
    parseAuthor(input.commitAuthor);
  }
}

/** Validates explicit model choices and Git values before the settings file changes. */
export async function configureFactory(
  input: ConfigureInput,
  ctx: ServiceContext = {},
  runtime?: AuthRuntime,
): Promise<FactorySettings> {
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
