import { ValidationError } from "../errors/errors.js";
import type { ServiceContext } from "../workspace/workspace.js";
import type { FactorySettings } from "./factory-settings.js";
import { getFactorySettings } from "./settings-file.js";

/** The settings key that the factory must have before it can start. */
export const WORKER_MODEL_SETTING = "factory.workerModel";

/** The provider that pi-agent-core gives a session without a model. */
export const PI_PLACEHOLDER_PROVIDER = "unknown";

/** Tells if the settings have the base worker model. The worker model overrides do not count. */
export function hasWorkerModel(settings: Pick<FactorySettings, "workerModel">): boolean {
  return settings.workerModel !== undefined;
}

/** Gives the error for a factory start or a worker launch without a worker model. */
export function workerModelMissingError(): ValidationError {
  return new ValidationError("No worker model is set. The factory cannot start without one", {
    hint: "Select it in the TUI under Settings › AI (key w), or run rowbly factory configure --worker <provider/model>. rowbly model list shows the models.",
    details: { setting: WORKER_MODEL_SETTING },
  });
}

/** Tells if an error is the error of a missing worker model. */
export function isWorkerModelMissing(error: unknown): boolean {
  return error instanceof ValidationError && error.details.setting === WORKER_MODEL_SETTING;
}

/** Throws a ValidationError when the Project has no base worker model. */
export async function assertWorkerModelSet(ctx: ServiceContext = {}): Promise<void> {
  const settings = await getFactorySettings(ctx);

  if (!hasWorkerModel(settings)) {
    throw workerModelMissingError();
  }
}
