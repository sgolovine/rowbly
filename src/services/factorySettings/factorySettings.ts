import { readFile } from "node:fs/promises";
import { ValidationError } from "../errors/errors.js";
import { writeFileAtomic } from "../files/files.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";

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
}
export function validModel(value: unknown): value is ModelChoice {
  if (!value || typeof value !== "object") return false;
  const model = value as ModelChoice;
  return (
    typeof model.provider === "string" &&
    !!model.provider.trim() &&
    typeof model.modelId === "string" &&
    !!model.modelId.trim() &&
    (model.thinkingLevel === undefined ||
      ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(model.thinkingLevel))
  );
}
function validate(value: unknown): FactorySettings {
  const settings = value as FactorySettings;
  if (
    settings?.version !== 1 ||
    !Number.isSafeInteger(settings.maxWorkers) ||
    settings.maxWorkers < 1 ||
    (settings.supervisorModel !== undefined && !validModel(settings.supervisorModel)) ||
    (settings.workerModel !== undefined && !validModel(settings.workerModel))
  )
    throw new ValidationError("Invalid factory settings");
  return settings;
}
export async function getFactorySettings(ctx: ServiceContext = {}): Promise<FactorySettings> {
  const paths = await findProject(ctx);
  try {
    return validate(JSON.parse(await readFile(paths.factorySettingsFile, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, maxWorkers: 4 };
    if (error instanceof SyntaxError) throw new ValidationError("Invalid factory settings JSON");
    throw error;
  }
}
export async function updateFactorySettings(
  input: Partial<Omit<FactorySettings, "version">>,
  ctx: ServiceContext = {},
): Promise<FactorySettings> {
  const paths = await findProject(ctx);
  const settings = validate({ ...(await getFactorySettings(ctx)), ...input, version: 1 });
  await writeFileAtomic(paths.factorySettingsFile, `${JSON.stringify(settings, null, 2)}\n`);
  return settings;
}

/** Validates explicit model choices before the settings file changes. */
export async function configureFactory(
  input: {
    maxWorkers?: number;
    supervisor?: string;
    worker?: string;
    supervisorThinking?: ModelChoice["thinkingLevel"];
    workerThinking?: ModelChoice["thinkingLevel"];
  },
  ctx: ServiceContext = {},
  runtime?: import("../agentAuth/agentAuth.js").AuthRuntime,
) {
  const { authRuntime, validateModelChoice } = await import("../agentAuth/agentAuth.js");
  const patch: Partial<Omit<FactorySettings, "version">> = {};
  if (input.maxWorkers !== undefined) patch.maxWorkers = input.maxWorkers;
  for (const role of ["supervisor", "worker"] as const) {
    const value = input[role];
    const thinkingLevel = input[`${role}Thinking`];
    if (!value && thinkingLevel) throw new ValidationError(`Select the ${role} model with its thinking level`);
    if (!value) continue;
    const slash = value.indexOf("/");
    if (slash < 1 || slash === value.length - 1) throw new ValidationError("Use provider/model for a model choice");
    const choice = { provider: value.slice(0, slash), modelId: value.slice(slash + 1), thinkingLevel };
    if (!validModel(choice)) throw new ValidationError("Invalid model choice");
    runtime ??= await authRuntime();
    patch[`${role}Model`] = await validateModelChoice(runtime, choice);
  }
  return updateFactorySettings(patch, ctx);
}
