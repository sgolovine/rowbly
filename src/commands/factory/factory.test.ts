import { readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as agentAuth from "../../services/agent-auth/agent-auth.js";
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
  describe("configure Git settings", () => {
    const readSettings = async () => JSON.parse(await project.read("factory.json"));
    const configure = (...args: string[]) => runCli(["--json", "factory", "configure", ...args], project.paths.root);
    const seed = { version: 1, maxWorkers: 2, workerModel: { provider: "faux", modelId: "test" } };

    it("writes the commit message and keeps the other keys, without the auth runtime", async () => {
      const auth = vi.spyOn(agentAuth, "authRuntime");
      await project.write("factory.json", JSON.stringify(seed));
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
      await project.write("factory.json", JSON.stringify(seed));
      const result = await configure("--commit-author", "Rowbly Bot <bot@example.com>");
      expect(result.exitCode).toBe(0);
      expect((await readSettings()).git).toEqual({ authorName: "Rowbly Bot", authorEmail: "bot@example.com" });
      expect((await readSettings()).workerModel).toEqual(seed.workerModel);
      expect(auth).not.toHaveBeenCalled();
    });
    it("rejects an author that is not in the Name <email> form and keeps factory.json", async () => {
      const text = JSON.stringify(seed);
      await project.write("factory.json", text);
      const result = await configure("--commit-author", "bot@example.com");
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr).error.code).toBe("VALIDATION");
      expect(await project.read("factory.json")).toBe(text);
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
      expect(await readSettings()).toEqual({ version: 1, maxWorkers: 4 });
    });
  });
});
