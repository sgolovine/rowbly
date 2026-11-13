import { writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { prepareRuntime, runtimePath } from "../runtime-files/runtime-files.js";
import { useTestProject } from "../test-project/test-project.js";
import { processCommands, pruneFactoryCommands, publishCommand, readReceipt } from "./factory-control.js";

describe("factory control receipts", () => {
  const project = useTestProject();
  it("deduplicates completed requests and rejects an old owner token", async () => {
    await prepareRuntime(project.paths);
    const current = await publishCommand(project.paths, {
      targetOwnerToken: "current",
      type: "cancel",
      threadId: "one",
      expectedRunId: "run",
    });
    const stale = await publishCommand(project.paths, { targetOwnerToken: "old", type: "stop" });
    const execute = vi.fn(async () => {});
    await processCommands(project.paths, "current", execute);
    await processCommands(project.paths, "current", execute);
    expect(execute).toHaveBeenCalledTimes(1);
    expect((await readReceipt(project.paths, current.id))?.status).toBe("completed");
    expect((await readReceipt(project.paths, stale.id))?.status).toBe("rejected");
  });
  it("preserves corrupt receipts without blocking another request", async () => {
    await prepareRuntime(project.paths);
    const bad = await publishCommand(project.paths, { targetOwnerToken: "current", type: "stop" });
    await writeFile(await runtimePath(project.paths, `receipts/${bad.id}.json`), "{");
    const good = await publishCommand(project.paths, { targetOwnerToken: "current", type: "stop" });
    const execute = vi.fn(async () => {});
    await processCommands(project.paths, "current", execute);
    expect(execute).toHaveBeenCalledTimes(1);
    expect((await readReceipt(project.paths, good.id))?.status).toBe("completed");
    await expect(readReceipt(project.paths, bad.id)).rejects.toThrow();
  });
  it("retains only current and previous command generations", async () => {
    await prepareRuntime(project.paths);
    const old = await publishCommand(project.paths, { targetOwnerToken: "old", type: "stop" });
    const previous = await publishCommand(project.paths, { targetOwnerToken: "previous", type: "stop" });
    const current = await publishCommand(project.paths, { targetOwnerToken: "current", type: "stop" });
    await processCommands(project.paths, "current", async () => {});
    await pruneFactoryCommands(project.paths, ["previous", "current"]);
    expect(await readReceipt(project.paths, old.id)).toBeUndefined();
    expect((await readReceipt(project.paths, previous.id))?.status).toBe("rejected");
    expect((await readReceipt(project.paths, current.id))?.status).toBe("completed");
  });
});
