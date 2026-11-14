import { describe, expect, it } from "vitest";
import { ValidationError } from "../errors/errors.js";
import { updateProject } from "../project/project.js";
import { useTestProject } from "../test-project/test-project.js";
import { configureFactory, configureGit, getFactorySettings, updateFactorySettings } from "./factory-settings.js";

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
