import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { type FactoryCommand, processCommands } from "../factory-control/factory-control.js";
import { acquireFactoryOwnership, newOwner } from "../factory-ownership/factory-ownership.js";
import { prepareRuntime } from "../runtime-files/runtime-files.js";
import { useTestProject } from "../test-project/test-project.js";
import { createThread } from "../thread/thread.js";
import { runtimePaths } from "../workspace/workspace.js";
import {
  dismissFactoryAttention,
  dismissFactoryAttentions,
  getFactoryStatus,
  releaseFactoryStory,
  sendFactoryCommand,
  steerThread,
} from "./factory.js";

describe("factory status probes", () => {
  const project = useTestProject();
  it("keeps a live owner with an old heartbeat and identifies a reused PID", async () => {
    const owner = await newOwner();
    await acquireFactoryOwnership(project.paths, owner);
    await writeFile(
      runtimePaths(project.paths).statusFile,
      JSON.stringify({ version: 1, phase: "ready", owner, heartbeatAt: "2000-01-01T00:00:00Z" }),
    );
    expect(await getFactoryStatus(project.ctx)).toMatchObject({ phase: "ready", liveness: "alive", responsive: false });
    await writeFile(runtimePaths(project.paths).lockFile, JSON.stringify({ ...owner, processIdentity: "reused:1" }));
    expect(await getFactoryStatus(project.ctx)).toMatchObject({ phase: "stopped", liveness: "dead" });
  });
  it("reports a corrupt owner as unavailable and preserves its bytes", async () => {
    await acquireFactoryOwnership(project.paths, await newOwner());
    const file = runtimePaths(project.paths).lockFile;
    await writeFile(file, "{");
    expect((await getFactoryStatus(project.ctx)).phase).toBe("unavailable");
    expect(await readFile(file, "utf8")).toBe("{");
  });
});

describe("factory attention dismiss", () => {
  const project = useTestProject();
  it("sends the attention key to the live daemon and waits for its receipt", async () => {
    await prepareRuntime(project.paths);
    const owner = await newOwner();
    await acquireFactoryOwnership(project.paths, owner);
    const execute = vi.fn(async () => {});
    const sent = dismissFactoryAttention("commit", { timeoutMs: 5000 }, project.ctx);
    await vi.waitFor(async () => {
      await processCommands(project.paths, owner.token, execute);
      expect(execute).toHaveBeenCalledWith(expect.objectContaining({ type: "dismiss", attentionKey: "commit" }));
    });
    await expect(sent).resolves.toMatchObject({ status: "completed" });
  });
  it("fails when the factory does not run or the key is not valid", async () => {
    await expect(dismissFactoryAttention("commit", {}, project.ctx)).rejects.toThrow("Factory is not running");
    await expect(dismissFactoryAttention("", {}, project.ctx)).rejects.toThrow("attention key");
    await expect(dismissFactoryAttention("k".repeat(129), {}, project.ctx)).rejects.toThrow("attention key");
  });
});

describe("factory attention dismiss of many keys", () => {
  const project = useTestProject();
  it("sends one dismiss for each key in order, continues after a failure and returns both lists", async () => {
    await prepareRuntime(project.paths);
    const owner = await newOwner();
    await acquireFactoryOwnership(project.paths, owner);
    const execute = vi.fn(async (_command: FactoryCommand) => {});
    const sent = dismissFactoryAttentions(["first", "", "second"], { timeoutMs: 5000 }, project.ctx);
    await vi.waitFor(async () => {
      await processCommands(project.paths, owner.token, execute);
      expect(execute).toHaveBeenCalledTimes(2);
    });
    const result = await sent;
    expect(execute.mock.calls.map(([command]) => [command.type, command.attentionKey])).toEqual([
      ["dismiss", "first"],
      ["dismiss", "second"],
    ]);
    expect(result.dismissed).toEqual(["first", "second"]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.key).toBe("");
    expect(String(result.failed[0]?.error)).toContain("attention key");
  });
  it("returns each key as failed when the factory does not run", async () => {
    const result = await dismissFactoryAttentions(["a", "b"], {}, project.ctx);
    expect(result.dismissed).toEqual([]);
    expect(result.failed.map((entry) => entry.key)).toEqual(["a", "b"]);
  });
  it("returns empty lists for no keys", async () => {
    expect(await dismissFactoryAttentions([], {}, project.ctx)).toEqual({ dismissed: [], failed: [] });
  });
});

describe("factory story release", () => {
  const project = useTestProject();
  it("sends the Story ID to the live daemon and waits for its receipt", async () => {
    await prepareRuntime(project.paths);
    const owner = await newOwner();
    await acquireFactoryOwnership(project.paths, owner);
    const execute = vi.fn(async () => {});
    const sent = releaseFactoryStory("TST-1", { timeoutMs: 5000 }, project.ctx);
    await vi.waitFor(async () => {
      await processCommands(project.paths, owner.token, execute);
      expect(execute).toHaveBeenCalledWith(expect.objectContaining({ type: "release-story", storyId: "TST-1" }));
    });
    await expect(sent).resolves.toMatchObject({ status: "completed", storyId: "TST-1" });
  });
  it("fails when the factory does not run or the Story ID is not valid", async () => {
    await expect(releaseFactoryStory("TST-1", {}, project.ctx)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Factory is not running",
    });
    await expect(releaseFactoryStory("", {}, project.ctx)).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("factory thread steer", () => {
  const project = useTestProject();
  async function liveOwner() {
    await prepareRuntime(project.paths);
    const owner = await newOwner();
    await acquireFactoryOwnership(project.paths, owner);
    const thread = await createThread(
      { role: "worker", storyId: "ROW-1", stage: "DEVELOP", cwd: project.paths.root, ownerToken: owner.token },
      project.ctx,
    );
    return { owner, thread };
  }
  it("sends the trimmed message with the Thread and run IDs and resolves on the completed receipt", async () => {
    const { owner, thread } = await liveOwner();
    const execute = vi.fn(async (_command: FactoryCommand) => {});
    const sent = steerThread(thread.id, "  Use the new API \n", { timeoutMs: 5000 }, project.ctx);
    await vi.waitFor(async () => {
      await processCommands(project.paths, owner.token, execute);
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "steer",
          threadId: thread.id,
          expectedRunId: thread.runs.at(-1)?.id,
          message: "Use the new API",
        }),
      );
    });
    await expect(sent).resolves.toMatchObject({ status: "completed" });
  });
  it("gives the rejection message of the daemon as a ConflictError", async () => {
    const { owner, thread } = await liveOwner();
    const execute = vi.fn(async () => {
      throw new Error("Worker is not working now");
    });
    const sent = sendFactoryCommand("steer", { threadId: thread.id, message: "Stop", timeoutMs: 5000 }, project.ctx);
    const settled = sent.catch((error) => error);
    await vi.waitFor(async () => {
      await processCommands(project.paths, owner.token, execute);
      expect(execute).toHaveBeenCalled();
    });
    expect(await settled).toMatchObject({ code: "CONFLICT", message: "Worker is not working now" });
  });
  it("fails without a live daemon, and fails validation for an empty or long message", async () => {
    await expect(steerThread("thread", "Stop", {}, project.ctx)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Factory is not running",
    });
    await expect(steerThread("thread", "   ", {}, project.ctx)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(steerThread("thread", "a".repeat(4001), {}, project.ctx)).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
});
