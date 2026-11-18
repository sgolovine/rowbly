import { describe, expect, it } from "vitest";
import { type TestProject, useTestProject } from "../test-project/test-project.js";
import { addCheck, listChecks, removeCheck, setCheckLimits, updateCheck } from "./check-items.js";
import { checkLimits, mergeChecks, validChecks } from "./check-settings.js";
import { configureFactory, getFactorySettings } from "./factory-settings.js";

async function readConfig(p: TestProject): Promise<Record<string, unknown>> {
  return JSON.parse(await p.read("rowbly.config.json"));
}

async function writeFactory(p: TestProject, factory: unknown): Promise<void> {
  await p.write("rowbly.config.json", JSON.stringify({ ...(await readConfig(p)), factory }, null, 2));
}

async function stored(p: TestProject): Promise<Record<string, unknown>> {
  return (await readConfig(p)).factory as Record<string, unknown>;
}

const test = { key: "test", command: "pnpm test", narrowCommand: "pnpm vitest related --run {files}" };

describe("check settings", () => {
  it("gives the defaults of absent keys, and no checks without a section", () => {
    expect(checkLimits(undefined)).toBeUndefined();
    expect(checkLimits({ items: [test] })).toEqual({
      maxConcurrent: 2,
      reserveMemoryMb: 2048,
      items: [{ ...test, label: "test", memoryMb: 1024, timeoutMinutes: 30, block: [] }],
    });
  });

  it("rejects limits out of range, bad keys, duplicate keys and a narrow command without {files}", () => {
    expect(validChecks({ maxConcurrent: 0 })).toBe(false);
    expect(validChecks({ maxConcurrent: 33 })).toBe(false);
    expect(validChecks({ items: [{ key: "Test", command: "x" }] })).toBe(false);
    expect(validChecks({ items: [test, test] })).toBe(false);
    expect(validChecks({ items: [{ key: "t", command: "x", narrowCommand: "y" }] })).toBe(false);
    expect(validChecks({ items: [{ key: "t", command: "x", timeoutMinutes: 241 }] })).toBe(false);
    expect(validChecks({ items: [{ key: "t", command: " " }] })).toBe(false);
    expect(validChecks({ maxConcurrent: 4, reserveMemoryMb: 0, items: [{ ...test, block: ["vitest"] }] })).toBe(true);
  });

  it("merges the configure values and keeps the other keys", () => {
    expect(mergeChecks({ items: [test] }, { maxChecks: 3 })).toEqual({ items: [test], maxConcurrent: 3 });
    expect(mergeChecks(undefined, {})).toBeUndefined();
    expect(mergeChecks(undefined, { checkMemoryReserve: 0 })).toEqual({ reserveMemoryMb: 0 });
  });
});

describe("check items", () => {
  const p = useTestProject();

  it("adds, updates, lists and removes checks without the defaults in the config", async () => {
    await writeFactory(p, { maxWorkers: 3, other: true });
    const { factory: _factory, ...otherKeys } = await readConfig(p);

    await addCheck(test, p.ctx);
    await updateCheck("test", { label: "Tests", narrowCommand: null, block: ["vitest"] }, p.ctx);

    expect(await listChecks(p.ctx)).toEqual([
      { key: "test", label: "Tests", command: "pnpm test", memoryMb: 1024, timeoutMinutes: 30, block: ["vitest"] },
    ]);
    expect(await readConfig(p)).toMatchObject(otherKeys);
    expect(await stored(p)).toEqual({
      maxWorkers: 3,
      other: true,
      checks: { items: [{ key: "test", command: "pnpm test", label: "Tests", block: ["vitest"] }] },
    });

    expect(await removeCheck("test", p.ctx)).toEqual([]);
    expect((await stored(p)).checks).toEqual({ items: [] });
  });

  it("rejects a duplicate, an unknown key and a bad value without a change of the config", async () => {
    await addCheck(test, p.ctx);
    const before = await p.read("rowbly.config.json");

    await expect(addCheck(test, p.ctx)).rejects.toThrow("already exists");
    await expect(updateCheck("lint", { command: "x" }, p.ctx)).rejects.toThrow("Unknown check");
    await expect(updateCheck("test", { timeoutMinutes: 0 }, p.ctx)).rejects.toThrow("Invalid factory checks");
    await expect(removeCheck("lint", p.ctx)).rejects.toThrow("Unknown check");
    expect(await p.read("rowbly.config.json")).toBe(before);
  });

  it("gives a ValidationError from getFactorySettings for an invalid checks section", async () => {
    await writeFactory(p, { maxWorkers: 2, checks: { maxConcurrent: 0 } });

    await expect(getFactorySettings(p.ctx)).rejects.toThrow("Invalid factory checks");
  });

  it("sets the limits without Pi, and keeps the items", async () => {
    await addCheck(test, p.ctx);
    await setCheckLimits({ maxChecks: 4, checkMemoryReserve: 0 }, p.ctx);

    expect((await stored(p)).checks).toEqual({
      items: [test],
      maxConcurrent: 4,
      reserveMemoryMb: 0,
    });
    await expect(setCheckLimits({ maxChecks: 0 }, p.ctx)).rejects.toThrow("Invalid factory checks");
  });

  it("sets the limits through configure", async () => {
    const settings = await configureFactory({ maxChecks: 3, checkMemoryReserve: 1024 }, p.ctx);

    expect(settings.checks).toEqual({ maxConcurrent: 3, reserveMemoryMb: 1024, items: [] });
    expect((await stored(p)).checks).toEqual({ maxConcurrent: 3, reserveMemoryMb: 1024 });
    await expect(configureFactory({ stage: "BACKLOG", maxChecks: 2 }, p.ctx)).rejects.toThrow("only the worker");
  });
});
