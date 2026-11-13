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
