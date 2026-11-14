import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readConfig } from "../config/config.js";
import { getFactorySettings } from "../factory-settings/factory-settings.js";
import { pathExists } from "../files/files.js";
import { useTestProject } from "../test-project/test-project.js";
import { doctor } from "./doctor.js";

const LEGACY = { version: 1, maxWorkers: 2, git: { push: true, syncIntervalSeconds: 120 } };
const MOVED = { maxWorkers: 2, git: { push: true, syncIntervalSeconds: 120 } };

describe("doctor factory checks", () => {
  const project = useTestProject();
  const legacyFile = join(".rowbly", "factory.json");
  const configFile = join(".rowbly", "rowbly.config.json");

  async function setFactory(factory: unknown) {
    const config = JSON.parse(await project.read("rowbly.config.json"));
    await project.write("rowbly.config.json", JSON.stringify({ ...config, factory }, null, 2));
  }

  async function factoryIssues(fix = false) {
    const report = await doctor({ fix }, project.ctx);
    return report.issues.filter((issue) => issue.file === legacyFile || issue.file === configFile);
  }

  it("reports nothing without a factory.json", async () => {
    expect(await factoryIssues()).toEqual([]);
  });

  it("moves a factory.json without version into the config with --fix", async () => {
    await project.write("factory.json", JSON.stringify(LEGACY));

    const report = await doctor({}, project.ctx);

    expect(report.ok).toBe(true);
    expect(await factoryIssues()).toEqual([
      expect.objectContaining({ severity: "warning", fix: "Move it to rowbly.config.json", fixed: false }),
    ]);

    expect(await factoryIssues(true)).toEqual([expect.objectContaining({ fixed: true })]);
    expect(await pathExists(project.paths.legacyFactorySettingsFile)).toBe(false);
    expect((await readConfig(project.paths)).factory).toEqual(MOVED);
    expect(await getFactorySettings(project.ctx)).toEqual({ ...MOVED, git: { ...MOVED.git, pull: false } });
    expect(await factoryIssues()).toEqual([]);
  });

  it("deletes a factory.json that has the same settings as the config", async () => {
    await project.write("factory.json", JSON.stringify(LEGACY));
    await setFactory({ git: { syncIntervalSeconds: 120, push: true }, maxWorkers: 2 });

    expect(await factoryIssues(true)).toEqual([expect.objectContaining({ fix: "Delete it", fixed: true })]);
    expect(await pathExists(project.paths.legacyFactorySettingsFile)).toBe(false);
    expect((await readConfig(project.paths)).factory).toEqual(MOVED);
  });

  it("keeps a factory.json with different settings, and tells to merge by hand", async () => {
    await project.write("factory.json", JSON.stringify(LEGACY));
    await setFactory({ maxWorkers: 3 });

    const issues = await factoryIssues(true);

    expect(issues).toEqual([expect.objectContaining({ severity: "warning", fixed: false })]);
    expect(issues[0]?.fix).toBeUndefined();
    expect(issues[0]?.message).toMatch(/Merge them by hand, then delete factory.json/);
    expect(await pathExists(project.paths.legacyFactorySettingsFile)).toBe(true);
    expect((await readConfig(project.paths)).factory).toEqual({ maxWorkers: 3 });
  });

  it.each([
    ["invalid JSON", "{broken"],
    ["a value that is not an object", "[1]"],
    ["invalid settings", JSON.stringify({ version: 1, maxWorkers: 0 })],
  ])("reports a factory.json with %s as an error, and keeps the file", async (_name, text) => {
    await project.write("factory.json", text);

    const report = await doctor({ fix: true }, project.ctx);

    expect(report.ok).toBe(false);
    expect(await factoryIssues(true)).toEqual([
      expect.objectContaining({ severity: "error", file: legacyFile, fixed: false }),
    ]);
    expect(await project.read("factory.json")).toBe(text);
    expect((await readConfig(project.paths)).factory).toBeUndefined();
  });

  it("reports an invalid factory section as an error, with or without a factory.json", async () => {
    await setFactory({ maxWorkers: "two" });

    expect(await factoryIssues(true)).toEqual([
      expect.objectContaining({ severity: "error", file: configFile, fixed: false }),
    ]);
    expect((await doctor({}, project.ctx)).ok).toBe(false);

    await project.write("factory.json", JSON.stringify(LEGACY));

    expect(await factoryIssues(true)).toEqual([
      expect.objectContaining({ severity: "error", file: configFile, fixed: false }),
      expect.objectContaining({ severity: "warning", file: legacyFile, fixed: false }),
    ]);
    expect(await pathExists(project.paths.legacyFactorySettingsFile)).toBe(true);
    expect((await readConfig(project.paths)).factory).toEqual({ maxWorkers: "two" });
  });

  it("keeps the moved settings and the new stage when one run fixes both", async () => {
    await project.write("factory.json", JSON.stringify(LEGACY));
    await project.write("stages/IN_REVIEW.md", "Review it");

    const report = await doctor({ fix: true }, project.ctx);

    expect(report.issues.filter((issue) => issue.fixed)).toHaveLength(2);
    const config = await readConfig(project.paths);
    expect(config.stages.at(-1)).toMatchObject({ key: "IN_REVIEW" });
    expect(config.factory).toEqual(MOVED);
    expect(await doctor({}, project.ctx)).toMatchObject({ issues: [], ok: true });
  });
});
