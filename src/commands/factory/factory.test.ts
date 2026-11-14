import { writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as agentAuth from "../../services/agent-auth/agent-auth.js";
import * as factory from "../../services/factory/factory.js";
import { newOwner } from "../../services/factory-ownership/factory-ownership.js";
import { prepareRuntime } from "../../services/runtime-files/runtime-files.js";
import { createStory } from "../../services/story/story.js";
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
  it("returns exit one for unavailable runtime status", async () => {
    await prepareRuntime(project.paths);
    await writeFile(`${project.paths.runtimeDir}/factory.lock`, "{");
    const result = await runCli(["--json", "factory", "status"], project.paths.root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("CONFLICT");
  });
  it("sets and clears Stage and Story worker model overrides", async () => {
    vi.spyOn(agentAuth, "authRuntime").mockResolvedValue({} as agentAuth.AuthRuntime);
    vi.spyOn(agentAuth, "validateModelChoice").mockImplementation(async (_runtime, choice) => choice);
    const story = await createStory({ title: "Override" }, project.ctx);
    const worker = { provider: "anthropic", modelId: "claude-opus-5-5" };
    await project.write("factory.json", JSON.stringify({ version: 1, maxWorkers: 2, workerModel: worker }));
    const cli = (...args: string[]) => runCli(["--json", "factory", "configure", ...args], project.paths.root);
    const staged = await cli("--stage", "BACKLOG", "--worker", "openai/gpt-sol");
    expect(staged.exitCode).toBe(0);
    expect(JSON.parse(staged.stdout)).toEqual({
      version: 1,
      maxWorkers: 2,
      workerModel: worker,
      stageWorkerModels: { BACKLOG: { provider: "openai", modelId: "gpt-sol" } },
    });
    const pinned = await cli(
      "--story",
      story.id,
      "--stage",
      "DONE",
      "--worker",
      "openai/gpt-sol",
      "--worker-thinking",
      "high",
    );
    expect(pinned.exitCode).toBe(0);
    expect(JSON.parse(await project.read("factory.json")).storyWorkerModels).toEqual({
      [story.id]: { DONE: { provider: "openai", modelId: "gpt-sol", thinkingLevel: "high" } },
    });
    expect((await cli("--story", story.id, "--stage", "DONE", "--clear-worker")).exitCode).toBe(0);
    expect((await cli("--stage", "BACKLOG", "--clear-worker")).exitCode).toBe(0);
    expect(JSON.parse(await project.read("factory.json"))).toEqual({ version: 1, maxWorkers: 2, workerModel: worker });
  });
  it("rejects invalid override flags without a write", async () => {
    const text = JSON.stringify({ version: 1, maxWorkers: 2 });
    await project.write("factory.json", text);
    const cli = (...args: string[]) => runCli(["--json", "factory", "configure", ...args], project.paths.root);
    const invalid = [
      ["--story", "ROW-1", "--worker", "a/b"],
      ["--clear-worker"],
      ["--stage", "BACKLOG", "--clear-worker", "--worker", "a/b"],
      ["--stage", "BACKLOG", "--worker", "a/b", "--supervisor", "a/b"],
      ["--stage", "BACKLOG", "--worker", "a/b", "--supervisor-thinking", "low"],
      ["--stage", "BACKLOG", "--worker", "a/b", "--max-workers", "3"],
      ["--stage", "NOPE", "--worker", "a/b"],
    ];
    for (const args of invalid) {
      const result = await cli(...args);
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr).error.code).toBe("VALIDATION");
    }
    const missing = await cli("--stage", "BACKLOG", "--story", "ROW-99", "--clear-worker");
    expect(missing.exitCode).toBe(1);
    expect(JSON.parse(missing.stderr).error.code).toBe("NOT_FOUND");
    expect(await project.read("factory.json")).toBe(text);
  });
});
