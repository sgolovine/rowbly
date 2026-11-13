import { describe, expect, it } from "vitest";
import { updateProject } from "../project/project.js";
import { useTestProject } from "../testProject/testProject.js";
import { getFactorySettings, updateFactorySettings } from "./factorySettings.js";

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
});
