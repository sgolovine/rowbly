import { readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as agentAuth from "../../services/agent-auth/agent-auth.js";
import * as factory from "../../services/factory/factory.js";
import { newOwner } from "../../services/factory-ownership/factory-ownership.js";
import { writeWatchdogState } from "../../services/factory-watchdog/factory-watchdog.js";
import { prepareRuntime } from "../../services/runtime-files/runtime-files.js";
import { createStage } from "../../services/stage/stage.js";
import { createStory } from "../../services/story/story.js";
import { useTestProject } from "../../services/test-project/test-project.js";
import { runCli } from "../test-cli/test-cli.js";

describe("factory commands", () => {
  const project = useTestProject();
  const readFactory = async () => JSON.parse(await project.read("rowbly.config.json")).factory;
  const writeFactory = async (text: string) => {
    const config = JSON.parse(await project.read("rowbly.config.json"));
    await project.write("rowbly.config.json", JSON.stringify({ ...config, factory: JSON.parse(text) }));
  };
  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });
  it("shows stopped status without credentials or runtime files", async () => {
    const result = await runCli(["--json", "factory", "status"], project.paths.root);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ version: 1, phase: "stopped", restarts: 0 });
  });
  it("shows the restart count, the last crash and the crash-limit entry in the JSON status", async () => {
    const owner = await newOwner();
    const lastCrashAt = new Date().toISOString();
    await writeWatchdogState(project.paths, {
      version: 1,
      pid: owner.pid,
      process: { ...owner, processIdentity: "gone" },
      phase: "failed",
      crashCount: 5,
      lastCrashAt,
      lastExit: "code 9",
      lastLog: "/logs/last.jsonl",
      updatedAt: lastCrashAt,
    });
    const result = await runCli(["--json", "factory", "status"], project.paths.root);
    expect(result.exitCode).toBe(0);
    const status = JSON.parse(result.stdout);
    expect(status).toMatchObject({ phase: "failed", restarts: 5, lastCrashAt });
    expect(status.attention[0][0]).toBe("watchdog:crash-limit");
    expect(status.attention[0][1].text).toContain("code 9");
    expect(status.attention[0][1].text).toContain("/logs/last.jsonl");
  });
  it("fails to release a Story without a live daemon", async () => {
    const result = await runCli(["--json", "factory", "release", "TST-1"], project.paths.root);
    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).toContain("Factory is not running");
  });
  it("releases a Story through the live daemon", async () => {
    const release = vi
      .spyOn(factory, "releaseFactoryStory")
      .mockResolvedValue({ version: 1, id: "cmd", ownerToken: "owner", status: "completed", storyId: "TST-1" });
    const result = await runCli(["--json", "factory", "release", "TST-1"], project.paths.root);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "completed", storyId: "TST-1" });
    expect(release).toHaveBeenCalledWith("TST-1", {}, expect.anything());
  });
  it("hides the watchdog command from the help", async () => {
    const result = await runCli(["factory", "--help"], project.paths.root);
    expect(result.stdout).not.toContain("watchdog");
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
    const settingsFile = project.paths.configFile;
    const on = await runCli(
      ["--json", "factory", "configure", "--git-push", "--git-pull", "--git-sync-interval", "120"],
      project.paths.root,
    );
    expect(on.exitCode).toBe(0);
    expect(JSON.parse(on.stdout).git).toEqual({ push: true, pull: true, syncIntervalSeconds: 120 });
    expect(JSON.parse(await readFile(settingsFile, "utf8")).factory.git).toEqual({
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
  it("rejects a sync interval below the limit without a change of the config", async () => {
    const settingsFile = project.paths.configFile;
    await runCli(["--json", "factory", "configure", "--git-pull"], project.paths.root);
    const before = await readFile(settingsFile, "utf8");

    const result = await runCli(["--json", "factory", "configure", "--git-sync-interval", "10"], project.paths.root);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error.code).toBe("VALIDATION");
    expect(await readFile(settingsFile, "utf8")).toBe(before);
  });
  it("turns pull-upstream on and off, and rejects other values without a change of the config", async () => {
    await writeFactory(JSON.stringify({ maxWorkers: 3, git: { push: true } }));
    const on = await runCli(["--json", "factory", "configure", "--pull-upstream", "on"], project.paths.root);
    expect(on.exitCode).toBe(0);
    expect(await readFactory()).toEqual({ maxWorkers: 3, git: { push: true }, dependencies: { pullUpstream: true } });
    const off = await runCli(["--json", "factory", "configure", "--pull-upstream", "off"], project.paths.root);
    expect(off.exitCode).toBe(0);
    expect(await readFactory()).toEqual({ maxWorkers: 3, git: { push: true }, dependencies: { pullUpstream: false } });
    const before = await project.read("rowbly.config.json");
    const result = await runCli(["--json", "factory", "configure", "--pull-upstream", "maybe"], project.paths.root);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr).error.code).toBe("VALIDATION");
    expect(await project.read("rowbly.config.json")).toBe(before);
  });
  it("sets the placement policy, and rejects an unknown policy without a change of the config", async () => {
    await writeFactory(JSON.stringify({ maxWorkers: 3, git: { push: true } }));
    const set = await runCli(["--json", "factory", "configure", "--placement", "most-free"], project.paths.root);
    expect(set.exitCode).toBe(0);
    expect(JSON.parse(set.stdout).placement).toBe("most-free");
    expect(await readFactory()).toEqual({ maxWorkers: 3, git: { push: true }, placement: "most-free" });
    const before = await project.read("rowbly.config.json");
    const result = await runCli(["--json", "factory", "configure", "--placement", "random"], project.paths.root);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr).error.code).toBe("VALIDATION");
    expect(await project.read("rowbly.config.json")).toBe(before);
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
    await writeFactory(JSON.stringify({ maxWorkers: 2, workerModel: worker }));
    const cli = (...args: string[]) => runCli(["--json", "factory", "configure", ...args], project.paths.root);
    const staged = await cli("--stage", "BACKLOG", "--worker", "openai/gpt-sol");
    expect(staged.exitCode).toBe(0);
    expect(JSON.parse(staged.stdout)).toEqual({
      maxWorkers: 2,
      workerModel: worker,
      stageWorkerModels: { BACKLOG: { provider: "openai", modelId: "gpt-sol" } },
      git: { push: false, pull: false, syncIntervalSeconds: 300 },
      placement: "prefer-local",
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
    expect((await readFactory()).storyWorkerModels).toEqual({
      [story.id]: { DONE: { provider: "openai", modelId: "gpt-sol", thinkingLevel: "high" } },
    });
    expect((await cli("--story", story.id, "--stage", "DONE", "--clear-worker")).exitCode).toBe(0);
    expect((await cli("--stage", "BACKLOG", "--clear-worker")).exitCode).toBe(0);
    expect(await readFactory()).toEqual({ maxWorkers: 2, workerModel: worker });
  });
  it("sets and clears the class of a Stage, and rejects invalid class flags without a write", async () => {
    await createStage({ label: "In Review", key: "IN_REVIEW", prompt: "Review it.", position: 2 }, project.ctx);
    await writeFactory(JSON.stringify({ maxWorkers: 2 }));
    const cli = (...args: string[]) => runCli(["--json", "factory", "configure", ...args], project.paths.root);
    const set = await cli("--stage", "IN_REVIEW", "--class", "hold");
    expect(set.exitCode).toBe(0);
    expect(JSON.parse(set.stdout).stageClasses).toEqual({ IN_REVIEW: "hold" });
    expect(await readFactory()).toEqual({ maxWorkers: 2, stageClasses: { IN_REVIEW: "hold" } });
    const before = await project.read("rowbly.config.json");
    const invalid = [
      ["--stage", "IN_REVIEW", "--class", "invalid"],
      ["--class", "hold"],
      ["--stage", "NOPE", "--class", "hold"],
      ["--stage", "IN_REVIEW", "--class", "work", "--clear-class"],
    ];
    for (const args of invalid) {
      const result = await cli(...args);
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr).error.code).toBe("VALIDATION");
    }
    expect(await project.read("rowbly.config.json")).toBe(before);
    expect((await cli("--stage", "IN_REVIEW", "--clear-class")).exitCode).toBe(0);
    expect(await readFactory()).toEqual({ maxWorkers: 2 });
  });
  it("rejects invalid override flags without a write", async () => {
    const text = JSON.stringify({ maxWorkers: 2 });
    await writeFactory(text);
    const before = await project.read("rowbly.config.json");
    const cli = (...args: string[]) => runCli(["--json", "factory", "configure", ...args], project.paths.root);
    const invalid = [
      ["--story", "ROW-1", "--worker", "a/b"],
      ["--clear-worker"],
      ["--stage", "BACKLOG", "--clear-worker", "--worker", "a/b"],
      ["--stage", "BACKLOG", "--worker", "a/b", "--max-workers", "3"],
      ["--stage", "BACKLOG", "--worker", "a/b", "--commit-message", "chore: sync"],
      ["--stage", "BACKLOG", "--clear-worker", "--git-push"],
      ["--stage", "BACKLOG", "--worker", "a/b", "--git-sync-interval", "120"],
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
    expect(await project.read("rowbly.config.json")).toBe(before);
  });
  it("rejects the old supervisor flags as unknown options", async () => {
    await writeFactory(JSON.stringify({ maxWorkers: 2 }));
    const before = await project.read("rowbly.config.json");
    for (const flag of ["--supervisor", "--supervisor-thinking"]) {
      const result = await runCli(["--json", "factory", "configure", flag, "x/y"], project.paths.root);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(`unknown option '${flag}'`);
    }
    expect(await project.read("rowbly.config.json")).toBe(before);
  });
  describe("configure fallback worker models", () => {
    const cli = (...args: string[]) => runCli(["--json", "factory", "configure", ...args], project.paths.root);
    const seed = { maxWorkers: 2, workerModel: { provider: "faux", modelId: "test" }, git: { push: true } };

    it("replaces the list in order, keeps the other keys, and clears it", async () => {
      vi.spyOn(agentAuth, "authRuntime").mockResolvedValue({} as agentAuth.AuthRuntime);
      const validate = vi
        .spyOn(agentAuth, "validateModelChoice")
        .mockImplementation(async (_runtime, choice) => choice);
      await writeFactory(JSON.stringify(seed));
      const config = JSON.parse(await project.read("rowbly.config.json"));
      const set = await cli("--fallback-worker", "a/x", "--fallback-worker", "b/y");
      expect(set.exitCode).toBe(0);
      expect(validate).toHaveBeenCalledTimes(2);
      const written = JSON.parse(await project.read("rowbly.config.json"));
      expect(written).toEqual({
        ...config,
        factory: {
          ...seed,
          fallbackWorkerModels: [
            { provider: "a", modelId: "x" },
            { provider: "b", modelId: "y" },
          ],
        },
      });
      expect((await cli("--fallback-worker", "c/z")).exitCode).toBe(0);
      expect((await readFactory()).fallbackWorkerModels).toEqual([{ provider: "c", modelId: "z" }]);
      const cleared = await cli("--clear-fallback-workers");
      expect(cleared.exitCode).toBe(0);
      expect(await readFactory()).toEqual(seed);
      expect(JSON.parse(cleared.stdout)).not.toHaveProperty("fallbackWorkerModels");
    });
    it("rejects invalid values and flag sets without a write", async () => {
      vi.spyOn(agentAuth, "authRuntime").mockResolvedValue({} as agentAuth.AuthRuntime);
      vi.spyOn(agentAuth, "validateModelChoice").mockImplementation(async (_runtime, choice) => choice);
      await writeFactory(JSON.stringify(seed));
      const before = await project.read("rowbly.config.json");
      const invalid = [
        ["--fallback-worker", "a/x", "--fallback-worker", "nomodel"],
        ["--fallback-worker", "/x"],
        ["--fallback-worker", "a/"],
        ["--fallback-worker", "a/x", "--clear-fallback-workers"],
        ["--stage", "BACKLOG", "--worker", "a/b", "--fallback-worker", "a/x"],
        ["--stage", "BACKLOG", "--clear-worker", "--clear-fallback-workers"],
        ["--story", "ROW-1", "--fallback-worker", "a/x"],
        ["--clear-worker", "--clear-fallback-workers"],
        ["--clear-worker", "--fallback-worker", "a/x"],
      ];
      for (const args of invalid) {
        const result = await cli(...args);
        expect(result.exitCode, args.join(" ")).toBe(1);
        expect(JSON.parse(result.stderr).error.code).toBe("VALIDATION");
      }
      expect(await project.read("rowbly.config.json")).toBe(before);
    });
  });
  describe("configure Git settings", () => {
    const readSettings = readFactory;
    const configure = (...args: string[]) => runCli(["--json", "factory", "configure", ...args], project.paths.root);
    const seed = { maxWorkers: 2, workerModel: { provider: "faux", modelId: "test" } };

    it("writes the commit message and keeps the other keys, without the auth runtime", async () => {
      const auth = vi.spyOn(agentAuth, "authRuntime");
      await writeFactory(JSON.stringify(seed));
      const result = await configure("--commit-message", "chore(rowbly): sync board");
      expect(result.exitCode).toBe(0);
      expect(await readSettings()).toEqual({ ...seed, git: { commitMessage: "chore(rowbly): sync board" } });
      expect(JSON.parse(result.stdout).git).toEqual({
        commitMessage: "chore(rowbly): sync board",
        push: false,
        pull: false,
        syncIntervalSeconds: 300,
      });
      expect(auth).not.toHaveBeenCalled();
    });
    it("writes the commit author name and email", async () => {
      const auth = vi.spyOn(agentAuth, "authRuntime");
      await writeFactory(JSON.stringify(seed));
      const result = await configure("--commit-author", "Rowbly Bot <bot@example.com>");
      expect(result.exitCode).toBe(0);
      expect((await readSettings()).git).toEqual({ authorName: "Rowbly Bot", authorEmail: "bot@example.com" });
      expect((await readSettings()).workerModel).toEqual(seed.workerModel);
      expect(auth).not.toHaveBeenCalled();
    });
    it("rejects an author that is not in the Name <email> form and keeps the config", async () => {
      const text = JSON.stringify(seed);
      await writeFactory(text);
      const before = await project.read("rowbly.config.json");
      const result = await configure("--commit-author", "bot@example.com");
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr).error.code).toBe("VALIDATION");
      expect(await project.read("rowbly.config.json")).toBe(before);
    });
    it("clears the message and the author with empty values", async () => {
      await configure("--commit-message", "chore: sync", "--commit-author", "Bot <bot@example.com>");
      expect((await readSettings()).git).toEqual({
        commitMessage: "chore: sync",
        authorName: "Bot",
        authorEmail: "bot@example.com",
      });
      expect((await configure("--commit-message", "")).exitCode).toBe(0);
      expect((await readSettings()).git).toEqual({ authorName: "Bot", authorEmail: "bot@example.com" });
      expect((await configure("--commit-author", "")).exitCode).toBe(0);
      expect(await readSettings()).toEqual({ maxWorkers: 4 });
    });
  });
});
