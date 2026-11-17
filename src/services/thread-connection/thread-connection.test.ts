import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { acquireFactoryOwnership, newOwner } from "../factory-ownership/factory-ownership.js";
import { prepareRuntime, runtimePath } from "../runtime-files/runtime-files.js";
import { useTestProject } from "../test-project/test-project.js";
import { createThread, transitionThread } from "../thread/thread-change.js";
import { getThreadWithConnection, listThreadsWithConnection } from "./thread-connection.js";

const SEEN = "2026-11-16T10:00:00.000Z";
const HOSTS = [
  { id: "local", state: "connected", max: 1, used: 0, free: 1 },
  { id: "mini", state: "disconnected", max: 1, used: 1, free: 0, lastSeenAt: SEEN, latencyMs: 30 },
];

describe("threads with connection", () => {
  const p = useTestProject();

  async function seed() {
    const remote = await createThread(
      { role: "worker", storyId: "ROW-01", stage: "WORK", cwd: p.paths.root, ownerToken: "o", host: "mini" },
      p.ctx,
    );
    await transitionThread(remote.id, { expectedRevision: remote.revision, status: "running" }, p.ctx);
    const local = await createThread(
      { role: "worker", storyId: "ROW-02", stage: "WORK", cwd: p.paths.root, ownerToken: "o" },
      p.ctx,
    );
    return { remote, local };
  }

  async function writeStatus(live: boolean) {
    await prepareRuntime(p.paths);
    const owner = await newOwner();
    if (live) await acquireFactoryOwnership(p.paths, owner);
    const status = { version: 1, phase: "ready", owner, heartbeatAt: new Date().toISOString(), hosts: HOSTS };
    await writeFile(await runtimePath(p.paths, "status.json"), JSON.stringify(status));
  }

  it("adds the lost connection to a remote Thread of a live factory", async () => {
    const { remote, local } = await seed();
    await writeStatus(true);

    const list = await listThreadsWithConnection({}, p.ctx);
    const connection = { state: "lost", host: "mini", hostState: "disconnected", lastSeenAt: SEEN };
    expect(list.threads.find((t) => t.id === remote.id)?.connection).toEqual(connection);
    expect(list.threads.find((t) => t.id === local.id)).not.toHaveProperty("connection");
    expect((await getThreadWithConnection(remote.id, p.ctx)).connection).toEqual(connection);
    expect(await getThreadWithConnection(local.id, p.ctx)).not.toHaveProperty("connection");
  });

  it("adds no connection when the factory is not running", async () => {
    const { remote } = await seed();
    await writeStatus(false);

    expect((await listThreadsWithConnection({}, p.ctx)).threads.every((t) => !("connection" in t))).toBe(true);
    expect(await getThreadWithConnection(remote.id, p.ctx)).not.toHaveProperty("connection");
  });
});
