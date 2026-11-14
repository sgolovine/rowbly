import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { processCommands } from "../factory-control/factory-control.js";
import { acquireFactoryOwnership, newOwner } from "../factory-ownership/factory-ownership.js";
import { prepareRuntime } from "../runtime-files/runtime-files.js";
import { useTestProject } from "../test-project/test-project.js";
import { runtimePaths } from "../workspace/workspace.js";
import { dismissFactoryAttention, getFactoryStatus } from "./factory.js";

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
