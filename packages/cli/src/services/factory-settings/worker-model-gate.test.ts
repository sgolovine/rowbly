import { describe, expect, it } from "vitest";
import { ValidationError } from "../errors/errors.js";
import { useTestProject } from "../test-project/test-project.js";
import { updateFactorySettings } from "./factory-settings.js";
import {
  assertWorkerModelSet,
  hasWorkerModel,
  isWorkerModelMissing,
  WORKER_MODEL_SETTING,
  workerModelMissingError,
} from "./worker-model-gate.js";

const model = { provider: "faux", modelId: "faux-1" };

describe("hasWorkerModel", () => {
  it("is false without a worker model", () => {
    expect(hasWorkerModel({})).toBe(false);
  });

  it("is false when only overrides and fallbacks have a model", () => {
    const settings = {
      maxWorkers: 4,
      stageWorkerModels: { BACKLOG: model },
      storyWorkerModels: { "P-1": { default: model } },
      fallbackWorkerModels: [model],
    };

    expect(hasWorkerModel(settings as never)).toBe(false);
  });

  it("is true with a worker model", () => {
    expect(hasWorkerModel({ workerModel: model })).toBe(true);
  });
});

describe("isWorkerModelMissing", () => {
  it("finds the error of the gate and not a different ValidationError", () => {
    expect(isWorkerModelMissing(workerModelMissingError())).toBe(true);
    expect(isWorkerModelMissing(new ValidationError("Other"))).toBe(false);
    expect(isWorkerModelMissing(new Error("No worker model"))).toBe(false);
  });
});

describe("assertWorkerModelSet", () => {
  const project = useTestProject();

  it("refuses a fresh Project", async () => {
    await expect(assertWorkerModelSet(project.ctx)).rejects.toMatchObject({
      code: "VALIDATION",
      details: { setting: WORKER_MODEL_SETTING },
      hint: expect.stringContaining("rowbly factory configure --worker"),
    });
  });

  it("refuses a Project with only a Stage override", async () => {
    await updateFactorySettings({ stageWorkerModels: { BACKLOG: model } }, project.ctx);

    await expect(assertWorkerModelSet(project.ctx)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("accepts a Project with a worker model", async () => {
    await updateFactorySettings({ workerModel: model }, project.ctx);

    await expect(assertWorkerModelSet(project.ctx)).resolves.toBeUndefined();
  });
});
