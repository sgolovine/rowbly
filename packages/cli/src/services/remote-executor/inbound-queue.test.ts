import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTestProject } from "../test-project/test-project.js";
import {
  acknowledgeInbound,
  clearInbound,
  queueInboundUpdates,
  readInboundQueue,
  withInboundUpdates,
} from "./inbound-queue.js";

const put = (path: string) => ({ type: "file.put" as const, path, content: "x" });

describe("inbound queue", () => {
  const project = useTestProject();

  it("gives each update the next seq, and writes the queue with mode 0600", async () => {
    expect(await readInboundQueue(project.paths, "mini", "t1")).toEqual({ version: 1, nextSeq: 1, updates: [] });

    await queueInboundUpdates(project.paths, "mini", "t1", [put(".rowbly/a"), put(".rowbly/b")]);
    const queue = await queueInboundUpdates(project.paths, "mini", "t1", [put(".rowbly/c")]);

    expect(queue.updates.map((update) => update.seq)).toEqual([1, 2, 3]);
    expect(queue.nextSeq).toBe(4);
    const file = join(project.paths.runtimeDir, "hosts", "mini", "threads", "t1", "inbound.json");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(queue);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("removes the acknowledged updates, and keeps nextSeq when it removes all updates", async () => {
    await queueInboundUpdates(project.paths, "mini", "t1", [put(".rowbly/a"), put(".rowbly/b"), put(".rowbly/c")]);

    await acknowledgeInbound(project.paths, "mini", "t1", 2);
    expect((await readInboundQueue(project.paths, "mini", "t1")).updates.map((update) => update.seq)).toEqual([3]);

    await clearInbound(project.paths, "mini", "t1");
    expect(await readInboundQueue(project.paths, "mini", "t1")).toEqual({ version: 1, nextSeq: 4, updates: [] });
    const next = await queueInboundUpdates(project.paths, "mini", "t1", [put(".rowbly/d")]);
    expect(next.updates).toEqual([{ ...put(".rowbly/d"), seq: 4 }]);
  });

  it("adds no update for an empty list", () => {
    const queue = { version: 1 as const, nextSeq: 5, updates: [] };
    expect(withInboundUpdates(queue, [])).toEqual(queue);
  });
});
