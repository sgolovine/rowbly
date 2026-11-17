import { describe, expect, it, vi } from "vitest";
import type { WorkerEvents } from "../factory-manager/worker-executor.js";
import type { HostRunState } from "../host-agent/host-run-state.js";
import { createStory } from "../story/story.js";
import { createScriptedHost } from "../test-project/scripted-host.js";
import { useTestProject } from "../test-project/test-project.js";
import type { ThreadRecord } from "../thread/thread.js";
import { createRemoteExecutor } from "./remote-executor.js";
import type { AbandonedThread } from "./remote-types.js";

const MODEL = { provider: "worker", modelId: "faux" };

function threadRecord(storyId: string): ThreadRecord {
  const createdAt = new Date().toISOString();
  return {
    version: 1,
    id: "t1",
    revision: 1,
    role: "worker",
    storyId,
    stage: "BACKLOG",
    status: "pending",
    createdAt,
    session: { id: "t1", file: null },
    cwd: "/main",
    host: "mini",
    runs: [{ id: "run-0", ownerToken: "owner", createdAt, status: "pending" }],
    resumable: false,
  };
}

function quietEvents(): WorkerEvents {
  const none = async () => undefined;
  return {
    worktreeReady: none,
    sessionOpened: none,
    message: async () => "MESSAGE",
    prompted: () => undefined,
    activity: none,
    resultReported: none,
    stopping: () => false,
    completed: none,
    failed: none,
    finished: none,
  };
}

describe("remote executor with abandoned Threads", () => {
  const project = useTestProject();

  function setup(sync: () => Promise<void> = async () => undefined) {
    const host = createScriptedHost();
    const log: unknown[][] = [];
    const state = { abandoned: [] as AbandonedThread[] };
    const executor = createRemoteExecutor({
      paths: project.paths,
      ctx: project.ctx,
      projectId: "p1",
      connect: async () => ({ transport: host.transport, rowbly: "/opt/rowbly/bin/rowbly", clone: "repo" }),
      maxWorkers: () => 2,
      model: () => MODEL,
      sync: async (name) => {
        log.push(["sync", name]);
        await sync();
      },
      abandon: async (threadId, name, reason) => {
        log.push(["abandon", threadId, name, reason]);
        state.abandoned = [{ threadId, host: name }];
      },
      abandoned: async () => state.abandoned,
      outcome: async (threadId, run: HostRunState) => {
        log.push(["outcome", threadId, run.endReason]);
        state.abandoned = [];
      },
      helloTimeoutMs: 2000,
    });
    return { host, log, executor, state };
  }

  it("abandons only a cancel that cannot reach the host", async () => {
    const story = await createStory({ title: "Remote" }, project.ctx);
    const online = setup();
    const running = online.executor.launch({ thread: threadRecord(story.id), story }, quietEvents());
    await vi.waitFor(() => expect(online.host.commands).toHaveLength(1));
    await online.executor.cancel("t1");
    online.host.sendRun("t1", { phase: "ended", endReason: "cancelled" });
    await running;
    expect(online.log.filter((entry) => entry[0] === "abandon")).toEqual([]);

    const offline = setup();
    const waiting = offline.executor.launch({ thread: threadRecord(story.id), story }, quietEvents());
    await vi.waitFor(() => expect(offline.host.commands).toHaveLength(1));
    offline.host.transport.disconnect();
    await offline.executor.cancel("t1");
    await waiting;
    expect(offline.log.filter((entry) => entry[0] === "abandon")).toEqual([["abandon", "t1", "mini", "cancel"]]);
  });

  it("abandons a release that cannot reach the host with the reason release, and queues a cancel", async () => {
    const story = await createStory({ title: "Remote" }, project.ctx);
    const online = setup();
    const running = online.executor.launch({ thread: threadRecord(story.id), story }, quietEvents());
    await vi.waitFor(() => expect(online.host.commands).toHaveLength(1));
    await online.executor.release?.("t1");
    expect(online.host.commands.map((command) => command.type)).toEqual(["launch", "cancel-thread"]);
    online.host.sendRun("t1", { phase: "ended", endReason: "cancelled" });
    await running;
    expect(online.log.filter((entry) => entry[0] === "abandon")).toEqual([]);

    const offline = setup();
    const waiting = offline.executor.launch({ thread: threadRecord(story.id), story }, quietEvents());
    await vi.waitFor(() => expect(offline.host.commands).toHaveLength(1));
    offline.host.transport.disconnect();
    await offline.executor.release?.("t1");
    await waiting;
    expect(offline.log.filter((entry) => entry[0] === "abandon")).toEqual([["abandon", "t1", "mini", "release"]]);
  });

  it("reconnects for an abandoned Thread without a run: the stop, the channel, the sync, then the outcome", async () => {
    const story = await createStory({ title: "Remote" }, project.ctx);
    const f = setup();
    const waiting = f.executor.launch({ thread: threadRecord(story.id), story }, quietEvents());
    await vi.waitFor(() => expect(f.host.commands).toHaveLength(1));
    f.host.transport.disconnect();
    await f.executor.cancel("t1");
    await waiting;

    f.host.transport.reconnect();
    const mark = f.host.events.length;
    const syncs = f.log.length;
    expect(await f.executor.reconnect("mini")).toBeUndefined();
    expect(f.host.events.slice(mark)).toEqual(["submit:cancel-thread", "attach"]);
    expect(f.log.slice(syncs)).toEqual([["sync", "mini"]]);
    expect(f.host.transport.openChannels).toBe(1);

    // A frame that is not the end does nothing. The end applies the outbox, then writes the outcome.
    f.host.sendRun("t1", { phase: "running" });
    f.host.sendRun("t1", { phase: "ended", endReason: "cancelled" });
    await vi.waitFor(() => expect(f.log.at(-1)).toEqual(["outcome", "t1", "cancelled"]));
    expect(f.log.slice(syncs)).toEqual([
      ["sync", "mini"],
      ["sync", "mini"],
      ["outcome", "t1", "cancelled"],
    ]);
    await vi.waitFor(() => expect(f.host.transport.openChannels).toBe(0));
    expect(await f.executor.reconnect("mini")).toBeUndefined();
  });

  it("keeps the end of an abandoned Thread until a sync of its host succeeds", async () => {
    const story = await createStory({ title: "Remote" }, project.ctx);
    const failing = { on: false };
    const f = setup(async () => {
      if (failing.on) throw new Error("Cannot reach mini");
    });
    const waiting = f.executor.launch({ thread: threadRecord(story.id), story }, quietEvents());
    await vi.waitFor(() => expect(f.host.commands).toHaveLength(1));
    f.host.transport.disconnect();
    await f.executor.cancel("t1");
    await waiting;
    f.host.transport.reconnect();
    expect(await f.executor.reconnect("mini")).toBeUndefined();

    failing.on = true;
    f.host.sendRun("t1", { phase: "ended", endReason: "cancelled" });
    await vi.waitFor(() => expect(f.log.filter((entry) => entry[0] === "sync")).toHaveLength(2));
    expect(f.log.some((entry) => entry[0] === "outcome")).toBe(false);
    expect(await f.executor.syncHosts()).toEqual(new Map([["mini", "Cannot reach mini"]]));

    failing.on = false;
    expect(await f.executor.syncHosts()).toEqual(new Map());
    expect(f.log.at(-1)).toEqual(["outcome", "t1", "cancelled"]);
    expect(await f.executor.syncHosts()).toEqual(new Map());
  });
});
