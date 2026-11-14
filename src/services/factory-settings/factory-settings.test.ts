import { describe, expect, it } from "vitest";
import { ValidationError } from "../errors/errors.js";
import { updateProject } from "../project/project.js";
import { useTestProject } from "../test-project/test-project.js";
import { getFactorySettings, updateFactorySettings } from "./factory-settings.js";

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
  it("accepts settings with or without a git section", async () => {
    await p.write("factory.json", JSON.stringify({ version: 1, maxWorkers: 2 }));
    expect((await getFactorySettings(p.ctx)).git).toBeUndefined();
    const git = { commitMessage: "chore: sync", authorName: "Bot", authorEmail: "bot@example.com" };
    await p.write("factory.json", JSON.stringify({ version: 1, maxWorkers: 2, git }));
    expect((await getFactorySettings(p.ctx)).git).toEqual(git);
  });
  it.each([{ commitMessage: "" }, { authorName: "Bot", authorEmail: 5 }, { authorName: "Bot" }, "git"])(
    "rejects the git section %j",
    async (git) => {
      await p.write("factory.json", JSON.stringify({ version: 1, maxWorkers: 2, git }));
      const error = await getFactorySettings(p.ctx).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as Error).message).toBe("Invalid factory settings");
    },
  );
});
