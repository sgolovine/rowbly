import { describe, expect, it } from "vitest";
import { updateProject } from "../project/project.js";
import { createStory } from "../story/story.js";
import { useTestProject } from "../test-project/test-project.js";
import { configureFactory, getFactorySettings, updateFactorySettings } from "./factory-settings.js";

const model = { provider: "faux", modelId: "test" };

describe("factorySettings", () => {
  const p = useTestProject();
  it("uses defaults without a settings file and preserves settings on config writes", async () => {
    expect(await getFactorySettings(p.ctx)).toEqual({ version: 1, maxWorkers: 4 });
    await updateFactorySettings({ maxWorkers: 2, workerModel: { provider: "faux", modelId: "test" } }, p.ctx);
    await updateProject({ name: "Other" }, p.ctx);
    expect((await getFactorySettings(p.ctx)).maxWorkers).toBe(2);
  });
  it("rejects malformed settings without replacement", async () => {
    await p.write("factory.json", "{broken");
    await expect(updateFactorySettings({ maxWorkers: 2 }, p.ctx)).rejects.toThrow("JSON");
    expect(await p.read("factory.json")).toBe("{broken");
  });
  it("validates limits and model choices", async () => {
    await expect(updateFactorySettings({ maxWorkers: 0 }, p.ctx)).rejects.toThrow("Invalid");
    await expect(updateFactorySettings({ workerModel: { provider: "", modelId: "test" } }, p.ctx)).rejects.toThrow(
      "Invalid",
    );
  });
  it("reads valid override maps and rejects invalid entries", async () => {
    const settings = {
      version: 1,
      maxWorkers: 4,
      stageWorkerModels: { BACKLOG: model },
      storyWorkerModels: { "ROW-1": { BACKLOG: { ...model, thinkingLevel: "high" } } },
    };
    await p.write("factory.json", JSON.stringify(settings));
    expect(await getFactorySettings(p.ctx)).toEqual(settings);
    for (const bad of [
      { stageWorkerModels: { BACKLOG: { provider: "faux" } } },
      { stageWorkerModels: [model] },
      { storyWorkerModels: { "ROW-1": model } },
      { storyWorkerModels: { "ROW-1": { BACKLOG: { ...model, thinkingLevel: "huge" } } } },
    ]) {
      await p.write("factory.json", JSON.stringify({ version: 1, maxWorkers: 4, ...bad }));
      await expect(getFactorySettings(p.ctx)).rejects.toThrow("Invalid factory settings");
    }
  });
  it("rejects invalid override flags without a change to factory.json", async () => {
    const text = JSON.stringify({ version: 1, maxWorkers: 2, workerModel: model });
    await p.write("factory.json", text);
    const story = await createStory({ title: "Override" }, p.ctx);
    const invalid = [
      { story: story.id, worker: "faux/test" },
      { clearWorker: true },
      { stage: "BACKLOG", clearWorker: true, worker: "faux/test" },
      { stage: "BACKLOG", worker: "faux/test", supervisor: "faux/test" },
      { stage: "BACKLOG", worker: "faux/test", supervisorThinking: "low" as const },
      { stage: "BACKLOG", worker: "faux/test", maxWorkers: 3 },
      { stage: "BACKLOG" },
      { stage: "NOPE", worker: "faux/test" },
    ];
    for (const input of invalid) {
      await expect(configureFactory(input, p.ctx)).rejects.toMatchObject({ code: "VALIDATION" });
    }
    await expect(
      configureFactory({ stage: "BACKLOG", story: "ROW-99", clearWorker: true }, p.ctx),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await p.read("factory.json")).toBe(text);
  });
  it("clears overrides and keeps other keys", async () => {
    const story = await createStory({ title: "Override" }, p.ctx);
    await updateFactorySettings(
      {
        maxWorkers: 2,
        workerModel: model,
        stageWorkerModels: { BACKLOG: model, DONE: model },
        storyWorkerModels: { [story.id]: { BACKLOG: model } },
      },
      p.ctx,
    );
    const before = await p.read("factory.json");
    expect(await configureFactory({ stage: "done", story: story.id, clearWorker: true }, p.ctx)).toMatchObject({
      storyWorkerModels: { [story.id]: { BACKLOG: model } },
    });
    expect(await p.read("factory.json")).toBe(before);
    await configureFactory({ stage: "BACKLOG", story: story.id, clearWorker: true }, p.ctx);
    expect(await getFactorySettings(p.ctx)).toEqual({
      version: 1,
      maxWorkers: 2,
      workerModel: model,
      stageWorkerModels: { BACKLOG: model, DONE: model },
    });
    await configureFactory({ stage: "BACKLOG", clearWorker: true }, p.ctx);
    expect((await getFactorySettings(p.ctx)).stageWorkerModels).toEqual({ DONE: model });
  });
});
