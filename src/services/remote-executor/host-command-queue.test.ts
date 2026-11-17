import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTestProject } from "../test-project/test-project.js";
import {
  type QueuedCommand,
  queueCommand,
  readCommandQueue,
  removeQueuedCommand,
  sendOrder,
  withQueuedCommand,
} from "./host-command-queue.js";

const at = "2026-01-01T00:00:00.000Z";
const command = (id: string, type: QueuedCommand["type"], threadId = "t1"): QueuedCommand => ({
  id,
  type,
  threadId,
  queuedAt: at,
});

describe("host command queue", () => {
  const project = useTestProject();

  it("writes runtime/hosts/<host>/commands.json with mode 0600 in folders with mode 0700", async () => {
    expect(await readCommandQueue(project.paths, "mini")).toEqual([]);

    await queueCommand(project.paths, "mini", command("a", "stop-thread"));
    await queueCommand(project.paths, "mini", command("b", "cancel-thread", "t2"));
    await queueCommand(project.paths, "mini", command("a", "stop-thread"));

    const file = join(project.paths.runtimeDir, "hosts", "mini", "commands.json");
    expect(await readCommandQueue(project.paths, "mini")).toEqual([
      command("a", "stop-thread"),
      command("b", "cancel-thread", "t2"),
    ]);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(join(file, ".."))).mode & 0o777).toBe(0o700);
    expect((await stat(join(file, "../.."))).mode & 0o777).toBe(0o700);

    await removeQueuedCommand(project.paths, "mini", "a");
    await removeQueuedCommand(project.paths, "mini", "missing");
    expect(await readCommandQueue(project.paths, "mini")).toEqual([command("b", "cancel-thread", "t2")]);

    await writeFile(file, "{");
    expect(await readCommandQueue(project.paths, "mini")).toEqual([]);
  });

  it("drops the launch of a Thread that gets a stop, and sends the stops first in the order of arrival", () => {
    const launch = command("l1", "launch");
    const other = command("l2", "resume", "t2");
    const queued = withQueuedCommand(
      withQueuedCommand([launch, other], command("s1", "stop-thread")),
      command("c2", "cancel-thread", "t3"),
    );

    expect(queued.map((entry) => entry.id)).toEqual(["l2", "s1", "c2"]);
    expect(sendOrder(queued).map((entry) => entry.id)).toEqual(["s1", "c2", "l2"]);
  });
});
