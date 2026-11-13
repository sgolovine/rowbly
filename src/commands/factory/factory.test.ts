import { writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as factory from "../../services/factory/factory.js";
import { newOwner } from "../../services/factoryOwnership/factoryOwnership.js";
import { prepareRuntime } from "../../services/runtimeFiles/runtimeFiles.js";
import { useTestProject } from "../../services/testProject/testProject.js";
import { runCli } from "../testCli/testCli.js";

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
  it("returns exit one for unavailable runtime status", async () => {
    await prepareRuntime(project.paths);
    await writeFile(`${project.paths.runtimeDir}/factory.lock`, "{");
    const result = await runCli(["--json", "factory", "status"], project.paths.root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("CONFLICT");
  });
});
