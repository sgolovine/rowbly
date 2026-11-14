import { describe, expect, it } from "vitest";
import { ValidationError } from "../errors/errors.js";
import { updateProject } from "../project/project.js";
import { useTestProject } from "../test-project/test-project.js";
import { getFactorySettings, updateFactorySettings } from "./factory-settings.js";

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
  it("reads the git section and fills absent keys with defaults", async () => {
    await p.write("factory.json", JSON.stringify({ version: 1, maxWorkers: 2, git: { push: true } }));
    expect((await getFactorySettings(p.ctx)).git).toEqual({ push: true, pull: false, syncIntervalSeconds: 300 });
    await p.write(
      "factory.json",
      JSON.stringify({ version: 1, maxWorkers: 2, git: { push: false, pull: true, syncIntervalSeconds: 60 } }),
    );
    expect((await getFactorySettings(p.ctx)).git).toEqual({ push: false, pull: true, syncIntervalSeconds: 60 });
  });
  it.each([
    { push: "yes" },
    { pull: 1 },
    { syncIntervalSeconds: 59 },
    { syncIntervalSeconds: 86401 },
    { syncIntervalSeconds: 120.5 },
    { syncIntervalSeconds: "300" },
  ])("rejects the invalid git keys %j", async (git) => {
    await p.write("factory.json", JSON.stringify({ version: 1, maxWorkers: 2, git }));
    await expect(getFactorySettings(p.ctx)).rejects.toBeInstanceOf(ValidationError);
  });
  it.each([5, "on", null, [true]])("rejects the git section %j", async (git) => {
    await p.write("factory.json", JSON.stringify({ version: 1, maxWorkers: 2, git }));
    await expect(getFactorySettings(p.ctx)).rejects.toBeInstanceOf(ValidationError);
  });
  it("keeps other git keys and the other settings when the sync keys change", async () => {
    const author = { name: "Factory", email: "factory@example.com" };
    await p.write(
      "factory.json",
      JSON.stringify({ version: 1, maxWorkers: 3, git: { author, message: "chore: scan", push: false } }),
    );
    await updateFactorySettings({ git: { push: true, syncIntervalSeconds: 120 } }, p.ctx);
    expect(JSON.parse(await p.read("factory.json"))).toEqual({
      version: 1,
      maxWorkers: 3,
      git: { author, message: "chore: scan", push: true, pull: false, syncIntervalSeconds: 120 },
    });
    await updateFactorySettings({ maxWorkers: 2 }, p.ctx);
    expect(JSON.parse(await p.read("factory.json")).git).toMatchObject({ author, push: true });
  });
  it("does not write an invalid sync interval", async () => {
    await updateFactorySettings({ git: { pull: true } }, p.ctx);
    const before = await p.read("factory.json");
    await expect(updateFactorySettings({ git: { syncIntervalSeconds: 10 } }, p.ctx)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await p.read("factory.json")).toBe(before);
  });
});
