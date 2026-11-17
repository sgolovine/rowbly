import { ValidationError } from "../errors/errors.js";

/** The model and the thinking level of one factory role. */
export interface ModelChoice {
  provider: string;
  modelId: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}

/** The worker model override maps, before validation. */
interface OverrideValues {
  readonly stageWorkerModels?: unknown;
  readonly storyWorkerModels?: unknown;
}

const THINKING_LEVELS: readonly unknown[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

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

/** Tells if a value is a plain object, not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validModelMap(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every(validModel);
}

/** Tells if the Stage and Story worker model overrides are absent or valid maps of model choices. */
export function validOverrides(settings: OverrideValues): boolean {
  const stories = settings.storyWorkerModels;

  return (
    (settings.stageWorkerModels === undefined || validModelMap(settings.stageWorkerModels)) &&
    (stories === undefined || (isRecord(stories) && Object.values(stories).every(validModelMap)))
  );
}

/** Parses `provider/model`. The provider and the model must not be empty. */
export function parseChoice(value: string, thinkingLevel: ModelChoice["thinkingLevel"]): ModelChoice {
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
