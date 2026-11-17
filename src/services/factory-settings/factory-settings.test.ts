import { describe, expect, it } from "vitest";
import { addCustomField } from "../custom-field/custom-field.js";
import { ConflictError, ValidationError } from "../errors/errors.js";
import { updateProject } from "../project/project.js";
import { createStage, updateStage } from "../stage/stage.js";
import { createStory } from "../story/story.js";
import { type TestProject, useTestProject } from "../test-project/test-project.js";
import {
  configureFactory,
  configureGit,
  getFactorySettings,
  pullUpstream,
  setWorkerOverride,
  updateFactorySettings,
  validFactorySettings,
} from "./factory-settings.js";

/** Sets the `factory` section of the config to the parsed JSON text. */
async function writeFactory(p: TestProject, text: string): Promise<void> {
  const config = JSON.parse(await p.read("rowbly.config.json"));
  await p.write("rowbly.config.json", JSON.stringify({ ...config, factory: JSON.parse(text) }, null, 2));
}

async function readFactory(p: TestProject): Promise<Record<string, unknown>> {
  return JSON.parse(await p.read("rowbly.config.json")).factory;
}

const model = { provider: "faux", modelId: "test" };
const git = { push: false, pull: false, syncIntervalSeconds: 300 };

describe("factorySettings", () => {
  const p = useTestProject();
  it("uses defaults without a factory section and preserves settings on config writes", async () => {
    expect(await getFactorySettings(p.ctx)).toEqual({
      maxWorkers: 4,
      git: { push: false, pull: false, syncIntervalSeconds: 300 },
      placement: "prefer-local",
    });
    await updateFactorySettings({ maxWorkers: 2, workerModel: { provider: "faux", modelId: "test" } }, p.ctx);
    await updateProject({ name: "Other" }, p.ctx);
    expect((await getFactorySettings(p.ctx)).maxWorkers).toBe(2);
  });
  it("rejects an invalid factory section without a change to the config", async () => {
    await writeFactory(p, JSON.stringify({ maxWorkers: "two" }));
    const before = await p.read("rowbly.config.json");
    await expect(getFactorySettings(p.ctx)).rejects.toBeInstanceOf(ValidationError);
    const error = await updateFactorySettings({ git: { push: true } }, p.ctx).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toBe("Invalid factory settings");
    expect(await p.read("rowbly.config.json")).toBe(before);
  });
  it("gives the default limit when the section has no maxWorkers", async () => {
    await writeFactory(p, JSON.stringify({ git: { push: true } }));
    expect(await getFactorySettings(p.ctx)).toEqual({
      maxWorkers: 4,
      git: { ...git, push: true },
      placement: "prefer-local",
    });
  });
  it("writes the factory section and keeps the other config keys", async () => {
    await addCustomField({ label: "Owner", type: "string" }, p.ctx);
    const seeded = JSON.parse(await p.read("rowbly.config.json"));
    await p.write(
      "rowbly.config.json",
      JSON.stringify({ ...seeded, skills: [{ name: "rowbly", harnesses: ["codex"] }] }, null, 2),
    );
    const before = JSON.parse(await p.read("rowbly.config.json"));
    expect(before.factory).toBeUndefined();
    expect(before.customFields).toHaveLength(1);
    await updateFactorySettings({ maxWorkers: 2 }, p.ctx);
    const after = JSON.parse(await p.read("rowbly.config.json"));
    expect(after).toEqual({ ...before, factory: { maxWorkers: 2 } });
    expect(Object.keys(after).at(-1)).toBe("factory");
  });
  it("keeps the factory section when other services write the config", async () => {
    await updateFactorySettings({ maxWorkers: 2, workerModel: model }, p.ctx);
    await createStage({ label: "Review" }, p.ctx);
    await updateStage({ key: "REVIEW", newKey: "QA", label: "QA" }, p.ctx);
    await addCustomField({ label: "Owner", type: "string" }, p.ctx);
    expect(await readFactory(p)).toEqual({ maxWorkers: 2, workerModel: model });
  });
  it("validates limits and model choices", async () => {
    await expect(updateFactorySettings({ maxWorkers: 0 }, p.ctx)).rejects.toThrow("Invalid");
    await expect(updateFactorySettings({ workerModel: { provider: "", modelId: "test" } }, p.ctx)).rejects.toThrow(
      "Invalid",
    );
  });
  it("reads valid override maps and rejects invalid entries", async () => {
    const settings = {
      maxWorkers: 4,
      stageWorkerModels: { BACKLOG: model },
      storyWorkerModels: { "ROW-1": { BACKLOG: { ...model, thinkingLevel: "high" } } },
      tagWorkerModels: { bug: model },
    };
    await writeFactory(p, JSON.stringify(settings));
    expect(await getFactorySettings(p.ctx)).toEqual({ ...settings, git, placement: "prefer-local" });
    for (const bad of [
      { stageWorkerModels: { BACKLOG: { provider: "faux" } } },
      { stageWorkerModels: [model] },
      { storyWorkerModels: { "ROW-1": model } },
      { storyWorkerModels: { "ROW-1": { BACKLOG: { ...model, thinkingLevel: "huge" } } } },
      { tagWorkerModels: { bug: { provider: "faux" } } },
      { tagWorkerModels: [model] },
      { tagWorkerModels: { bug: { ...model, thinkingLevel: "huge" } } },
      { tagWorkerModels: "bug" },
    ]) {
      expect(validFactorySettings({ maxWorkers: 4, ...bad })).toBe(false);
      await writeFactory(p, JSON.stringify({ maxWorkers: 4, ...bad }));
      await expect(getFactorySettings(p.ctx)).rejects.toThrow("Invalid factory settings");
    }
  });
  it("rejects invalid override flags without a change to the config", async () => {
    await writeFactory(p, JSON.stringify({ maxWorkers: 2, workerModel: model }));
    const story = await createStory({ title: "Override" }, p.ctx);
    const invalid = [
      { story: story.id, worker: "faux/test" },
      { clearWorker: true },
      { stage: "BACKLOG", clearWorker: true, worker: "faux/test" },
      { stage: "BACKLOG", worker: "faux/test", supervisor: "faux/test" },
      { stage: "BACKLOG", worker: "faux/test", supervisorThinking: "low" as const },
      { stage: "BACKLOG", worker: "faux/test", maxWorkers: 3 },
      { stage: "BACKLOG", worker: "faux/test", commitAuthor: "Bot <bot@example.com>" },
      { stage: "BACKLOG", clearWorker: true, gitPull: true },
      { stage: "BACKLOG" },
      { stage: "NOPE", worker: "faux/test" },
    ];
    for (const input of invalid) {
      await expect(configureFactory(input, p.ctx)).rejects.toMatchObject({ code: "VALIDATION" });
    }
    await expect(
      configureFactory({ stage: "BACKLOG", story: "ROW-99", clearWorker: true }, p.ctx),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await readFactory(p)).toEqual({ maxWorkers: 2, workerModel: model });
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
    const before = await p.read("rowbly.config.json");
    expect(await configureFactory({ stage: "done", story: story.id, clearWorker: true }, p.ctx)).toMatchObject({
      storyWorkerModels: { [story.id]: { BACKLOG: model } },
    });
    expect(await p.read("rowbly.config.json")).toBe(before);
    await configureFactory({ stage: "BACKLOG", story: story.id, clearWorker: true }, p.ctx);
    expect(await getFactorySettings(p.ctx)).toEqual({
      maxWorkers: 2,
      workerModel: model,
      stageWorkerModels: { BACKLOG: model, DONE: model },
      git,
      placement: "prefer-local",
    });
    await configureFactory({ stage: "BACKLOG", clearWorker: true }, p.ctx);
    expect((await getFactorySettings(p.ctx)).stageWorkerModels).toEqual({ DONE: model });
  });
  it("sets and removes one override with setWorkerOverride, and keeps the other keys", async () => {
    const story = await createStory({ title: "Override" }, p.ctx);
    const high = { ...model, thinkingLevel: "high" as const };
    await updateFactorySettings({ maxWorkers: 3, workerModel: model }, p.ctx);
    await setWorkerOverride({ stage: "backlog" }, high, p.ctx);
    await setWorkerOverride({ stage: "BACKLOG", storyId: story.id }, model, p.ctx);
    expect(await getFactorySettings(p.ctx)).toEqual({
      maxWorkers: 3,
      workerModel: model,
      stageWorkerModels: { BACKLOG: high },
      storyWorkerModels: { [story.id]: { BACKLOG: model } },
      git,
      placement: "prefer-local",
    });
    await setWorkerOverride({ stage: "BACKLOG", storyId: story.id }, undefined, p.ctx);
    await setWorkerOverride({ stage: "BACKLOG" }, undefined, p.ctx);
    expect(await readFactory(p)).toEqual({ maxWorkers: 3, workerModel: model });
  });
  it("rejects an unknown Stage, an unknown Story and an invalid model in setWorkerOverride", async () => {
    await expect(setWorkerOverride({ stage: "NOPE" }, model, p.ctx)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(setWorkerOverride({ stage: "BACKLOG", storyId: "ROW-99" }, model, p.ctx)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(setWorkerOverride({ stage: "BACKLOG" }, { provider: "", modelId: "x" }, p.ctx)).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
  it("reads the git section and fills absent sync keys with defaults", async () => {
    await writeFactory(p, JSON.stringify({ maxWorkers: 2, git: { push: true } }));
    expect((await getFactorySettings(p.ctx)).git).toEqual({ push: true, pull: false, syncIntervalSeconds: 300 });
    await writeFactory(p, JSON.stringify({ maxWorkers: 2, git: { push: false, pull: true, syncIntervalSeconds: 60 } }));
    expect((await getFactorySettings(p.ctx)).git).toEqual({ push: false, pull: true, syncIntervalSeconds: 60 });
  });
  it("accepts settings with or without a git section", async () => {
    await writeFactory(p, JSON.stringify({ maxWorkers: 2 }));
    expect((await getFactorySettings(p.ctx)).git).toEqual({ push: false, pull: false, syncIntervalSeconds: 300 });
    const git = { commitMessage: "chore: sync", authorName: "Bot", authorEmail: "bot@example.com" };
    await writeFactory(p, JSON.stringify({ maxWorkers: 2, git }));
    expect((await getFactorySettings(p.ctx)).git).toEqual({
      ...git,
      push: false,
      pull: false,
      syncIntervalSeconds: 300,
    });
  });
  it.each([
    { commitMessage: "" },
    { authorName: "Bot", authorEmail: 5 },
    { authorName: "Bot" },
    "git",
    5,
    null,
    [true],
    { push: "yes" },
    { pull: 1 },
    { syncIntervalSeconds: 59 },
    { syncIntervalSeconds: 86401 },
    { syncIntervalSeconds: 120.5 },
    { syncIntervalSeconds: "300" },
  ])("rejects the git section %j", async (git) => {
    await writeFactory(p, JSON.stringify({ maxWorkers: 2, git }));
    const error = await getFactorySettings(p.ctx).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toBe("Invalid factory settings");
  });
  it("keeps the commit keys, other git keys and the other settings when the sync keys change", async () => {
    const commit = { commitMessage: "chore: scan", authorName: "Factory", authorEmail: "factory@example.com" };
    await writeFactory(p, JSON.stringify({ maxWorkers: 3, git: { ...commit, other: "kept", push: false } }));
    await updateFactorySettings({ git: { push: true, syncIntervalSeconds: 120 } }, p.ctx);
    expect(await readFactory(p)).toEqual({
      maxWorkers: 3,
      git: { ...commit, other: "kept", push: true, syncIntervalSeconds: 120 },
    });
    await configureFactory({ gitPull: true, gitSyncInterval: 600 }, p.ctx);
    expect((await readFactory(p)).git).toEqual({
      ...commit,
      other: "kept",
      push: true,
      pull: true,
      syncIntervalSeconds: 600,
    });
    await updateFactorySettings({ maxWorkers: 2 }, p.ctx);
    expect((await readFactory(p)).git).toMatchObject({ ...commit, push: true, pull: true });
  });
  it("does not write the sync defaults, and clears a commit key without a return of the old value", async () => {
    await configureFactory({ commitMessage: "chore: scan" }, p.ctx);
    expect((await readFactory(p)).git).toEqual({ commitMessage: "chore: scan" });
    await configureFactory({ commitMessage: "", gitPush: true }, p.ctx);
    expect((await readFactory(p)).git).toEqual({ push: true });
  });
  it("gives pullUpstream as false when the key is absent, and rejects a value that is not a boolean", async () => {
    const settings = await getFactorySettings(p.ctx);
    expect(settings.dependencies?.pullUpstream ?? false).toBe(false);
    expect(pullUpstream(settings)).toBe(false);
    expect(validFactorySettings({ dependencies: { pullUpstream: "yes" } })).toBe(false);
    expect(validFactorySettings({ dependencies: [] })).toBe(false);
    expect(validFactorySettings({ dependencies: { pullUpstream: true } })).toBe(true);
    await writeFactory(p, JSON.stringify({ dependencies: { pullUpstream: "yes" } }));
    await expect(getFactorySettings(p.ctx)).rejects.toThrow("Invalid factory settings");
  });
  it("configures pullUpstream with on and off, and keeps the other keys", async () => {
    await writeFactory(p, JSON.stringify({ maxWorkers: 3, git: { push: true } }));
    await configureFactory({ pullUpstream: "on" }, p.ctx);
    expect(await readFactory(p)).toEqual({ maxWorkers: 3, git: { push: true }, dependencies: { pullUpstream: true } });
    expect(pullUpstream(await getFactorySettings(p.ctx))).toBe(true);
    await configureFactory({ pullUpstream: "off" }, p.ctx);
    expect(await readFactory(p)).toEqual({ maxWorkers: 3, git: { push: true }, dependencies: { pullUpstream: false } });
    const before = await p.read("rowbly.config.json");
    await expect(configureFactory({ pullUpstream: "maybe" }, p.ctx)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(configureFactory({ stage: "BACKLOG", pullUpstream: "on" }, p.ctx)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(await p.read("rowbly.config.json")).toBe(before);
  });
  it("gives prefer-local without a placement key, and writes a policy without a change of the other keys", async () => {
    await writeFactory(p, JSON.stringify({ maxWorkers: 3, git: { push: true }, dependencies: { pullUpstream: true } }));
    const { factory: _before, ...others } = JSON.parse(await p.read("rowbly.config.json"));
    expect((await getFactorySettings(p.ctx)).placement).toBe("prefer-local");
    await updateFactorySettings({ maxWorkers: 2 }, p.ctx);
    expect((await readFactory(p)).placement).toBeUndefined();
    await updateFactorySettings({ placement: "most-free" }, p.ctx);
    expect(await readFactory(p)).toEqual({
      maxWorkers: 2,
      git: { push: true },
      dependencies: { pullUpstream: true },
      placement: "most-free",
    });
    const { factory: _after, ...kept } = JSON.parse(await p.read("rowbly.config.json"));
    expect(kept).toEqual(others);
    expect((await getFactorySettings(p.ctx)).placement).toBe("most-free");
    await configureFactory({ placement: "prefer-remote" }, p.ctx);
    expect((await readFactory(p)).placement).toBe("prefer-remote");
  });
  it("rejects an unknown placement policy in the config and in configureFactory", async () => {
    await writeFactory(p, JSON.stringify({ maxWorkers: 3, placement: "random" }));
    expect(validFactorySettings({ maxWorkers: 3, placement: "random" })).toBe(false);
    expect(validFactorySettings({ maxWorkers: 3, placement: "most-free" })).toBe(true);
    await expect(getFactorySettings(p.ctx)).rejects.toBeInstanceOf(ValidationError);
    await writeFactory(p, JSON.stringify({ maxWorkers: 3 }));
    const before = await p.read("rowbly.config.json");
    await expect(configureFactory({ placement: "random" }, p.ctx)).rejects.toBeInstanceOf(ValidationError);
    await expect(configureFactory({ stage: "BACKLOG", placement: "most-free" }, p.ctx)).rejects.toThrow(
      "only the worker model",
    );
    expect(await p.read("rowbly.config.json")).toBe(before);
  });
  it("validates the fallback worker models in the config", async () => {
    const model = { provider: "a", modelId: "x" };
    expect(validFactorySettings({ fallbackWorkerModels: [model, { ...model, thinkingLevel: "high" }] })).toBe(true);
    expect(validFactorySettings({ fallbackWorkerModels: [] })).toBe(true);
    expect(validFactorySettings({ fallbackWorkerModels: model })).toBe(false);
    expect(validFactorySettings({ fallbackWorkerModels: "a/x" })).toBe(false);
    expect(validFactorySettings({ fallbackWorkerModels: [model, { provider: "a" }] })).toBe(false);
    expect(validFactorySettings({ fallbackWorkerModels: [{ ...model, thinkingLevel: "huge" }] })).toBe(false);
    await writeFactory(p, JSON.stringify({ fallbackWorkerModels: ["a/x"] }));
    await expect(getFactorySettings(p.ctx)).rejects.toThrow("Invalid factory settings");
  });
  it("does not write an invalid sync interval", async () => {
    await updateFactorySettings({ git: { pull: true } }, p.ctx);
    const before = await p.read("rowbly.config.json");
    await expect(updateFactorySettings({ git: { syncIntervalSeconds: 10 } }, p.ctx)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(configureFactory({ gitSyncInterval: 10 }, p.ctx)).rejects.toBeInstanceOf(ValidationError);
    expect(await p.read("rowbly.config.json")).toBe(before);
  });
  it("configures only the git section, and keeps the other keys", async () => {
    await writeFactory(
      p,
      JSON.stringify({ maxWorkers: 3, workerModel: { provider: "faux", modelId: "test" }, git: { x: 1 } }),
    );
    await configureGit({ commitAuthor: "Factory Bot <bot@example.com>", commitMessage: "chore: board" }, p.ctx);
    await configureGit({ gitPush: true, gitSyncInterval: 120 }, p.ctx);
    expect(await readFactory(p)).toEqual({
      maxWorkers: 3,
      workerModel: { provider: "faux", modelId: "test" },
      git: {
        x: 1,
        authorName: "Factory Bot",
        authorEmail: "bot@example.com",
        commitMessage: "chore: board",
        push: true,
        syncIntervalSeconds: 120,
      },
    });
    await configureGit({ commitAuthor: "", commitMessage: "" }, p.ctx);
    expect((await readFactory(p)).git).toEqual({ x: 1, push: true, syncIntervalSeconds: 120 });
  });
  it("does not write an invalid author or interval with configureGit", async () => {
    await configureGit({ gitPull: true }, p.ctx);
    const before = await p.read("rowbly.config.json");
    await expect(configureGit({ commitAuthor: "Bot" }, p.ctx)).rejects.toThrow("Name <email>");
    await expect(configureGit({ gitSyncInterval: 86_401 }, p.ctx)).rejects.toBeInstanceOf(ValidationError);
    expect(await p.read("rowbly.config.json")).toBe(before);
  });
  it("refuses each settings write while an old factory.json exists, and changes nothing", async () => {
    await updateFactorySettings({ maxWorkers: 2 }, p.ctx);
    await p.write("factory.json", JSON.stringify({ version: 1, maxWorkers: 3 }));
    const before = await p.read("rowbly.config.json");
    const writes = [
      () => updateFactorySettings({ maxWorkers: 5 }, p.ctx),
      () => configureGit({ gitPush: true }, p.ctx),
      () => configureFactory({ maxWorkers: 5 }, p.ctx),
      () => setWorkerOverride({ stage: "BACKLOG" }, model, p.ctx),
    ];
    for (const write of writes) {
      const error = await write().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ConflictError);
      expect(error).toMatchObject({ hint: expect.stringContaining("rowbly doctor --fix") });
    }
    expect(await p.read("rowbly.config.json")).toBe(before);
    expect((await getFactorySettings(p.ctx)).maxWorkers).toBe(2);
  });
});
