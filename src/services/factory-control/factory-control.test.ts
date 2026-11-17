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
  it("accepts the type release and rejects an unknown type", async () => {
    await prepareRuntime(project.paths);
    const release = await publishCommand(project.paths, {
      targetOwnerToken: "current",
      type: "release",
      threadId: "one",
      expectedRunId: "run",
    });
    const unknown = await publishCommand(project.paths, {
      targetOwnerToken: "current",
      type: "abandon" as "release",
    });
    const execute = vi.fn(async () => {});
    await processCommands(project.paths, "current", execute);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ type: "release", threadId: "one" }));
    expect((await readReceipt(project.paths, release.id))?.status).toBe("completed");
    expect((await readReceipt(project.paths, unknown.id))?.status).toBe("rejected");
  });
  it("executes the commands one at a time, in the order of their file names", async () => {
    await prepareRuntime(project.paths);
    const published = await Promise.all(
      [1, 2, 3].map(() => publishCommand(project.paths, { targetOwnerToken: "current", type: "stop" })),
    );
    const order: string[] = [];
    const execute = vi.fn(async (command: { id: string }) => {
      expect(order).toHaveLength(execute.mock.calls.length - 1);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(command.id);
    });
    await processCommands(project.paths, "current", execute);
    expect(order).toEqual(published.map((command) => command.id).toSorted());
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
  it("accepts a dismiss with an attention key and rejects a dismiss without one", async () => {
    await prepareRuntime(project.paths);
    const good = await publishCommand(project.paths, {
      targetOwnerToken: "current",
      type: "dismiss",
      attentionKey: "commit",
    });
    const missing = await publishCommand(project.paths, { targetOwnerToken: "current", type: "dismiss" });
    const long = await publishCommand(project.paths, {
      targetOwnerToken: "current",
      type: "dismiss",
      attentionKey: "k".repeat(129),
    });
    const execute = vi.fn(async () => {});
    await processCommands(project.paths, "current", execute);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ type: "dismiss", attentionKey: "commit" }));
    expect((await readReceipt(project.paths, good.id))?.status).toBe("completed");
    expect(await readReceipt(project.paths, missing.id)).toMatchObject({
      status: "rejected",
      error: { message: "An attention key of 1 to 128 characters is necessary" },
    });
    expect((await readReceipt(project.paths, long.id))?.status).toBe("rejected");
  });
  it("accepts a steer with a valid message and rejects a missing, empty or long message", async () => {
    await prepareRuntime(project.paths);
    const steer = (message?: string) =>
      publishCommand(project.paths, {
        targetOwnerToken: "current",
        type: "steer",
        threadId: "one",
        expectedRunId: "run",
        message,
      });
    const good = await steer("Use the new API");
    const missing = await steer(undefined);
    const empty = await steer("   \n ");
    const long = await steer("a".repeat(4001));
    const execute = vi.fn(async () => {});
    await processCommands(project.paths, "current", execute);
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ type: "steer", message: "Use the new API" }),
    );
    expect((await readReceipt(project.paths, good.id))?.status).toBe("completed");
    for (const command of [missing, empty, long]) {
      expect(await readReceipt(project.paths, command.id)).toMatchObject({
        status: "rejected",
        error: { message: "A message of 1 to 4000 characters is necessary" },
      });
    }
  });
  it("accepts a steer file with a 4000-character message, also with multibyte and escaped characters", async () => {
    await prepareRuntime(project.paths);
    const messages = ["a".repeat(4000), "😀".repeat(4000), 'é"'.repeat(2000), "\u0001".repeat(4000)];
    const published = await Promise.all(
      messages.map((message) =>
        publishCommand(project.paths, {
          targetOwnerToken: "current",
          type: "steer",
          threadId: "one",
          expectedRunId: "run",
          message,
        }),
      ),
    );
    const execute = vi.fn(async () => {});
    await processCommands(project.paths, "current", execute);
    expect(execute).toHaveBeenCalledTimes(messages.length);
    for (const command of published) {
      expect((await readReceipt(project.paths, command.id))?.status).toBe("completed");
    }
  });
  it("rejects a command file larger than 32768 bytes", async () => {
    await prepareRuntime(project.paths);
    const big = await publishCommand(project.paths, {
      targetOwnerToken: "current",
      type: "steer",
      threadId: "one",
      expectedRunId: "run",
      message: "a".repeat(40_000),
    });
    const execute = vi.fn(async () => {});
    await processCommands(project.paths, "current", execute);
    expect(execute).not.toHaveBeenCalled();
    expect(await readReceipt(project.paths, big.id)).toMatchObject({
      status: "rejected",
      error: { message: "Command is too large" },
    });
  });
});
