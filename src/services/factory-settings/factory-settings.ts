import { readFile } from "node:fs/promises";
import { ValidationError } from "../errors/errors.js";
import { writeFileAtomic } from "../files/files.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";

type AgentAuth = typeof import("../agent-auth/agent-auth.js");
type AuthRuntime = import("../agent-auth/agent-auth.js").AuthRuntime;
type Role = "supervisor" | "worker";

export interface ModelChoice {
  provider: string;
  modelId: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}

/** The Git sync of the canonical checkout. Other keys of the `git` section stay in the file. */
export interface GitSettings {
  readonly push: boolean;
  readonly pull: boolean;
  readonly syncIntervalSeconds: number;
}

export interface FactorySettings {
  version: 1;
  maxWorkers: number;
  supervisorModel?: ModelChoice;
  workerModel?: ModelChoice;
  git?: GitSettings;
}

/** The changes of an update. The `git` keys merge into the current `git` section. */
export type FactorySettingsInput = Partial<Omit<FactorySettings, "version" | "git">> & {
  git?: Partial<GitSettings>;
};

interface ConfigureInput {
  maxWorkers?: number;
  supervisor?: string;
  worker?: string;
  supervisorThinking?: ModelChoice["thinkingLevel"];
  workerThinking?: ModelChoice["thinkingLevel"];
  gitPush?: boolean;
  gitPull?: boolean;
  gitSyncInterval?: number;
}

/** The model choice of one role, and the runtime that the next role can use again. */
interface RoleChoice {
  readonly runtime?: AuthRuntime;
  readonly choice?: ModelChoice;
}

const THINKING_LEVELS: readonly unknown[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const DEFAULT_GIT: GitSettings = { push: false, pull: false, syncIntervalSeconds: 300 };
const DEFAULT_SETTINGS: FactorySettings = { version: 1, maxWorkers: 4, git: DEFAULT_GIT };
const MIN_SYNC_SECONDS = 60;
const MAX_SYNC_SECONDS = 86_400;

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

/** Tells if a sync interval is a whole number of seconds in the permitted range. */
function validInterval(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= MIN_SYNC_SECONDS && (value as number) <= MAX_SYNC_SECONDS;
}

/** Tells if a `git` section is absent, or an object with valid sync keys. A key can be absent. */
function validGit(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const git = value as Partial<GitSettings>;

  return (
    (git.push === undefined || typeof git.push === "boolean") &&
    (git.pull === undefined || typeof git.pull === "boolean") &&
    (git.syncIntervalSeconds === undefined || validInterval(git.syncIntervalSeconds))
  );
}

/** Validates the settings, then fills the absent `git` keys with their defaults. */
function validate(value: unknown): FactorySettings {
  const settings = value as FactorySettings;

  if (
    settings?.version !== 1 ||
    !Number.isSafeInteger(settings.maxWorkers) ||
    settings.maxWorkers < 1 ||
    (settings.supervisorModel !== undefined && !validModel(settings.supervisorModel)) ||
    (settings.workerModel !== undefined && !validModel(settings.workerModel)) ||
    !validGit(settings.git)
  ) {
    throw new ValidationError("Invalid factory settings", {
      hint: `Use booleans for git.push and git.pull, and ${MIN_SYNC_SECONDS} to ${MAX_SYNC_SECONDS} for git.syncIntervalSeconds`,
    });
  }

  return { ...settings, git: { ...DEFAULT_GIT, ...settings.git } };
}

/** Gives the Git sync settings. Settings without a `git` section use the defaults. */
export function gitSettings(settings: FactorySettings): GitSettings {
  return { ...DEFAULT_GIT, ...settings.git };
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

/** Reads the factory settings of the Project. Without `factory.json`, the limit is four workers and sync is off. */
export async function getFactorySettings(ctx: ServiceContext = {}): Promise<FactorySettings> {
  const paths = await findProject(ctx);

  return readFile(paths.factorySettingsFile, "utf8")
    .then((text) => validate(JSON.parse(text)))
    .catch(readProblem);
}

/** Merges the input into the factory settings and writes `factory.json`. */
export async function updateFactorySettings(
  input: FactorySettingsInput,
  ctx: ServiceContext = {},
): Promise<FactorySettings> {
  const paths = await findProject(ctx);
  const current = await getFactorySettings(ctx);
  const settings = validate({ ...current, ...input, git: { ...current.git, ...input.git }, version: 1 });

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

/** Gives only the Git sync keys that the input sets. */
function gitInput(input: ConfigureInput): Partial<GitSettings> {
  return {
    ...(input.gitPush !== undefined ? { push: input.gitPush } : {}),
    ...(input.gitPull !== undefined ? { pull: input.gitPull } : {}),
    ...(input.gitSyncInterval !== undefined ? { syncIntervalSeconds: input.gitSyncInterval } : {}),
  };
}

/** Validates explicit model choices before the settings file changes. */
export async function configureFactory(
  input: ConfigureInput,
  ctx: ServiceContext = {},
  runtime?: AuthRuntime,
): Promise<FactorySettings> {
  const auth = await import("../agent-auth/agent-auth.js");

  const supervisor = await chooseRole(auth, "supervisor", input, runtime);
  const worker = await chooseRole(auth, "worker", input, supervisor.runtime);

  return updateFactorySettings(
    {
      ...(input.maxWorkers !== undefined ? { maxWorkers: input.maxWorkers } : {}),
      ...(supervisor.choice ? { supervisorModel: supervisor.choice } : {}),
      ...(worker.choice ? { workerModel: worker.choice } : {}),
      git: gitInput(input),
    },
    ctx,
  );
}
