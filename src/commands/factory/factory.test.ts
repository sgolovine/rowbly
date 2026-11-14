import { readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as factory from "../../services/factory/factory.js";
import { newOwner } from "../../services/factory-ownership/factory-ownership.js";
import { prepareRuntime } from "../../services/runtime-files/runtime-files.js";
import { useTestProject } from "../../services/test-project/test-project.js";
import { runCli } from "../test-cli/test-cli.js";

describe("factory commands", () => {
  const project = useTestProject();
  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });
  it("shows stopped status without credentials or runtime files", async () => {
    const result = await runCli(["--json", "factory", "status"], project.paths.root);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ version: 1, phase: "stopped" });
  });
  it("starts the detached client by default", async () => {
    const start = vi
      .spyOn(factory, "startFactory")
      .mockResolvedValue({ version: 1, phase: "ready", owner: await newOwner() });
    const result = await runCli(["--json", "factory", "start"], project.paths.root);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).phase).toBe("ready");
    expect(start).toHaveBeenCalledOnce();
  });
  it("configures the Git sync keys and keeps the keys of flags that are not given", async () => {
    const settingsFile = `${project.paths.root}/.rowbly/factory.json`;
    const on = await runCli(
      ["--json", "factory", "configure", "--git-push", "--git-pull", "--git-sync-interval", "120"],
      project.paths.root,
    );
    expect(on.exitCode).toBe(0);
    expect(JSON.parse(on.stdout).git).toEqual({ push: true, pull: true, syncIntervalSeconds: 120 });
    expect(JSON.parse(await readFile(settingsFile, "utf8")).git).toEqual({
      push: true,
      pull: true,
      syncIntervalSeconds: 120,
    });

    const off = await runCli(["--json", "factory", "configure", "--no-git-push"], project.paths.root);
    expect(off.exitCode).toBe(0);
    expect(JSON.parse(off.stdout).git).toEqual({ push: false, pull: true, syncIntervalSeconds: 120 });

    const pullOff = await runCli(["--json", "factory", "configure", "--no-git-pull"], project.paths.root);
    expect(JSON.parse(pullOff.stdout).git).toEqual({ push: false, pull: false, syncIntervalSeconds: 120 });

    const workers = await runCli(["--json", "factory", "configure", "--max-workers", "2"], project.paths.root);
    expect(JSON.parse(workers.stdout)).toMatchObject({
      maxWorkers: 2,
      git: { push: false, pull: false, syncIntervalSeconds: 120 },
    });
  });
  it("rejects a sync interval below the limit without a change of factory.json", async () => {
    const settingsFile = `${project.paths.root}/.rowbly/factory.json`;
    await runCli(["--json", "factory", "configure", "--git-pull"], project.paths.root);
    const before = await readFile(settingsFile, "utf8");

    const result = await runCli(["--json", "factory", "configure", "--git-sync-interval", "10"], project.paths.root);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error.code).toBe("VALIDATION");
    expect(await readFile(settingsFile, "utf8")).toBe(before);
  });
  it("returns exit one for unavailable runtime status", async () => {
    await prepareRuntime(project.paths);
    await writeFile(`${project.paths.runtimeDir}/factory.lock`, "{");
    const result = await runCli(["--json", "factory", "status"], project.paths.root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("CONFLICT");
  });
});
