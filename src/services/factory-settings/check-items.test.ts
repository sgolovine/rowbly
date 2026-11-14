import { describe, expect, it } from "vitest";
import { ConflictError } from "../errors/errors.js";
import { useTestProject } from "../test-project/test-project.js";
import { addCheck, listChecks, removeCheck, setCheckLimits, updateCheck } from "./check-items.js";

describe("check items", () => {
  const p = useTestProject();

  it("adds, changes and removes a check, and keeps the other factory keys", async () => {
    await setCheckLimits({ maxChecks: 2 }, p.ctx);
    await addCheck({ key: "test", command: "pnpm test" }, p.ctx);
    await updateCheck("test", { label: "Tests" }, p.ctx);
    expect((await listChecks(p.ctx)).map((check) => [check.key, check.label])).toEqual([["test", "Tests"]]);
    expect(await removeCheck("test", p.ctx)).toEqual([]);
    expect(JSON.parse(await p.read("rowbly.config.json")).factory.checks.maxConcurrent).toBe(2);
  });

  it("refuses a check write while an old factory.json exists, and changes nothing", async () => {
    await addCheck({ key: "test", command: "pnpm test" }, p.ctx);
    await p.write("factory.json", JSON.stringify({ version: 1, maxWorkers: 3 }));
    const before = await p.read("rowbly.config.json");
    await expect(addCheck({ key: "lint", command: "pnpm lint" }, p.ctx)).rejects.toBeInstanceOf(ConflictError);
    await expect(updateCheck("test", { label: "Tests" }, p.ctx)).rejects.toBeInstanceOf(ConflictError);
    await expect(removeCheck("test", p.ctx)).rejects.toBeInstanceOf(ConflictError);
    await expect(setCheckLimits({ maxChecks: 2 }, p.ctx)).rejects.toBeInstanceOf(ConflictError);
    expect(await p.read("rowbly.config.json")).toBe(before);
    expect((await listChecks(p.ctx)).map((check) => check.key)).toEqual(["test"]);
  });
});
