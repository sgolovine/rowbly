import { describe, expect, it } from "vitest";
import { ValidationError } from "../errors/errors.js";
import { updateProject } from "../project/project.js";
import { createStory } from "../story/story.js";
import { useTestProject } from "../test-project/test-project.js";
import {
  configureFactory,
  configureGit,
  getFactorySettings,
  setWorkerOverride,
  updateFactorySettings,
} from "./factory-settings.js";

const model = { provider: "faux", modelId: "test" };
const git = { push: false, pull: false, syncIntervalSeconds: 300 };

describe("factorySettings", () => {
  const p = useTestProject();
  it("uses defaults without a settings file and preserves settings on config writes", async () => {
    expect(await getFactorySettings(p.ctx)).toEqual({
      version: 1,
      maxWorkers: 4,
      git: { push: false, pull: false, syncIntervalSeconds: 300 },
    });
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
    expect(await getFactorySettings(p.ctx)).toEqual({ ...settings, git });
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
      git,
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
      version: 1,
      maxWorkers: 3,
      workerModel: model,
      stageWorkerModels: { BACKLOG: high },
      storyWorkerModels: { [story.id]: { BACKLOG: model } },
      git,
    });
    await setWorkerOverride({ stage: "BACKLOG", storyId: story.id }, undefined, p.ctx);
    await setWorkerOverride({ stage: "BACKLOG" }, undefined, p.ctx);
    expect(JSON.parse(await p.read("factory.json"))).toEqual({ version: 1, maxWorkers: 3, workerModel: model });
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
    await p.write("factory.json", JSON.stringify({ version: 1, maxWorkers: 2, git: { push: true } }));
    expect((await getFactorySettings(p.ctx)).git).toEqual({ push: true, pull: false, syncIntervalSeconds: 300 });
    await p.write(
      "factory.json",
      JSON.stringify({ version: 1, maxWorkers: 2, git: { push: false, pull: true, syncIntervalSeconds: 60 } }),
    );
    expect((await getFactorySettings(p.ctx)).git).toEqual({ push: false, pull: true, syncIntervalSeconds: 60 });
  });
  it("accepts settings with or without a git section", async () => {
    await p.write("factory.json", JSON.stringify({ version: 1, maxWorkers: 2 }));
    expect((await getFactorySettings(p.ctx)).git).toEqual({ push: false, pull: false, syncIntervalSeconds: 300 });
    const git = { commitMessage: "chore: sync", authorName: "Bot", authorEmail: "bot@example.com" };
    await p.write("factory.json", JSON.stringify({ version: 1, maxWorkers: 2, git }));
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
    await p.write("factory.json", JSON.stringify({ version: 1, maxWorkers: 2, git }));
    const error = await getFactorySettings(p.ctx).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toBe("Invalid factory settings");
  });
  it("keeps the commit keys, other git keys and the other settings when the sync keys change", async () => {
    const commit = { commitMessage: "chore: scan", authorName: "Factory", authorEmail: "factory@example.com" };
    await p.write(
      "factory.json",
      JSON.stringify({ version: 1, maxWorkers: 3, git: { ...commit, other: "kept", push: false } }),
    );
    await updateFactorySettings({ git: { push: true, syncIntervalSeconds: 120 } }, p.ctx);
    expect(JSON.parse(await p.read("factory.json"))).toEqual({
      version: 1,
      maxWorkers: 3,
      git: { ...commit, other: "kept", push: true, syncIntervalSeconds: 120 },
    });
    await configureFactory({ gitPull: true, gitSyncInterval: 600 }, p.ctx);
    expect(JSON.parse(await p.read("factory.json")).git).toEqual({
      ...commit,
      other: "kept",
      push: true,
      pull: true,
      syncIntervalSeconds: 600,
    });
    await updateFactorySettings({ maxWorkers: 2 }, p.ctx);
    expect(JSON.parse(await p.read("factory.json")).git).toMatchObject({ ...commit, push: true, pull: true });
  });
  it("does not write the sync defaults, and clears a commit key without a return of the old value", async () => {
    await configureFactory({ commitMessage: "chore: scan" }, p.ctx);
    expect(JSON.parse(await p.read("factory.json")).git).toEqual({ commitMessage: "chore: scan" });
    await configureFactory({ commitMessage: "", gitPush: true }, p.ctx);
    expect(JSON.parse(await p.read("factory.json")).git).toEqual({ push: true });
  });
  it("does not write an invalid sync interval", async () => {
    await updateFactorySettings({ git: { pull: true } }, p.ctx);
    const before = await p.read("factory.json");
    await expect(updateFactorySettings({ git: { syncIntervalSeconds: 10 } }, p.ctx)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(configureFactory({ gitSyncInterval: 10 }, p.ctx)).rejects.toBeInstanceOf(ValidationError);
    expect(await p.read("factory.json")).toBe(before);
  });
  it("configures only the git section, and keeps the other keys", async () => {
    await p.write(
      "factory.json",
      JSON.stringify({ version: 1, maxWorkers: 3, workerModel: { provider: "faux", modelId: "test" }, git: { x: 1 } }),
    );
    await configureGit({ commitAuthor: "Factory Bot <bot@example.com>", commitMessage: "chore: board" }, p.ctx);
    await configureGit({ gitPush: true, gitSyncInterval: 120 }, p.ctx);
    expect(JSON.parse(await p.read("factory.json"))).toEqual({
      version: 1,
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
    expect(JSON.parse(await p.read("factory.json")).git).toEqual({ x: 1, push: true, syncIntervalSeconds: 120 });
  });
  it("does not write an invalid author or interval with configureGit", async () => {
    await configureGit({ gitPull: true }, p.ctx);
    const before = await p.read("factory.json");
    await expect(configureGit({ commitAuthor: "Bot" }, p.ctx)).rejects.toThrow("Name <email>");
    await expect(configureGit({ gitSyncInterval: 86_401 }, p.ctx)).rejects.toBeInstanceOf(ValidationError);
    expect(await p.read("factory.json")).toBe(before);
  });
});
