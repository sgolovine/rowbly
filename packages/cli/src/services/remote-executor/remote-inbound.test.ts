import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { addAttachment, listAttachments } from "../attachment/attachment.js";
import type { WorkerEvents } from "../factory-manager/worker-executor.js";
import { hostCacheMissing, hostCachePut } from "../host-agent/host-agent-cache.js";
import { hostAgentPaths, threadPaths } from "../host-agent/host-agent-paths.js";
import { prepareHostThread } from "../host-agent/host-agent-prepare.js";
import { applyHostInbound } from "../host-agent/host-inbound.js";
import { HostUnreachableError } from "../host-transport/host-errors.js";
import { readCopyBase } from "../outbox-apply/host-files.js";
import { createStory, getStory, type Story, updateStory } from "../story/story.js";
import { createScriptedHost, type ScriptedHost } from "../test-project/scripted-host.js";
import { useTempDir, useTestProject } from "../test-project/test-project.js";
import type { ThreadRecord } from "../thread/thread.js";
import { buildThreadCopy } from "../thread-copy/thread-copy.js";
import { readInboundQueue } from "./inbound-queue.js";
import { createRemoteExecutor } from "./remote-executor.js";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const MODEL = { provider: "worker", modelId: "faux" };
const ROWBLY = "/opt/rowbly/bin/rowbly";

function threadRecord(id: string, storyId: string): ThreadRecord {
  const createdAt = new Date().toISOString();
  return {
    version: 1,
    id,
    revision: 1,
    role: "worker",
    storyId,
    stage: "BACKLOG",
    status: "pending",
    createdAt,
    session: { id, file: null },
    cwd: "/main",
    host: "mini",
    runs: [{ id: "run-0", ownerToken: "owner", createdAt, status: "pending" }],
    resumable: false,
  };
}

function events(log: unknown[][]): WorkerEvents {
  const push =
    (name: string) =>
    async (...args: unknown[]) =>
      void log.push([name, ...args]);
  return {
    worktreeReady: push("worktree"),
    sessionOpened: push("session"),
    message: async () => "MESSAGE",
    prompted: () => undefined,
    activity: push("activity"),
    resultReported: push("result"),
    stopping: () => false,
    completed: push("completed"),
    failed: push("failed"),
    finished: push("finished"),
  };
}

/** Starts the run with a session for a launch, and ends it for a stop. */
function script(command: { type: string; threadId: string }, host: ScriptedHost): void {
  if (command.type === "stop-thread") {
    host.sendRun(command.threadId, { phase: "ended", endReason: "stopped" });
    return;
  }
  if (command.type !== "launch") return;
  const worktree = { path: "/host/repo-worktrees/x", branch: "story/x" };
  host.sendRun(command.threadId, { phase: "starting", worktree });
  host.sendRun(command.threadId, { phase: "running", worktree, session: { model: MODEL, file: "s.jsonl" } });
}

describe("remote inbound updates", () => {
  const project = useTestProject();
  const home = useTempDir();
  const hostPaths = () => hostAgentPaths("p1", home.path);
  const copyCtx = (threadId = "t1") => ({ cwd: threadPaths(hostPaths(), threadId).copy });

  /** A scripted host that runs the real host services for the copy, the cache and the inbound updates. */
  function setup(options: { loseInbound?: { on: boolean } } = {}) {
    const host: ScriptedHost = createScriptedHost({
      onSubmit: script,
      handle: async (name, input) => {
        if (name === "prepare") return prepareHostThread(hostPaths(), input, { home: home.path });
        if (name === "cache-missing") return hostCacheMissing(hostPaths(), input);
        if (name !== "inbound") return undefined;
        const answer = await applyHostInbound(hostPaths(), input);
        if (options.loseInbound?.on) {
          options.loseInbound.on = false;
          throw new HostUnreachableError("Cannot reach fake-host: Connection closed.");
        }
        return answer;
      },
      upload: async (command, data) => void (await hostCachePut(hostPaths(), command[4] as string, data)),
    });
    const log: unknown[][] = [];
    const executor = createRemoteExecutor({
      paths: project.paths,
      ctx: project.ctx,
      projectId: "p1",
      connect: async () => ({ transport: host.transport, rowbly: ROWBLY, clone: "repo" }),
      maxWorkers: () => 2,
      model: () => MODEL,
      sync: async () => undefined,
      helloTimeoutMs: 2000,
    });
    return { host, log, executor };
  }

  async function launch(f: ReturnType<typeof setup>, story: Story, threadId = "t1") {
    const log: unknown[][] = [];
    const done = f.executor.launch({ thread: threadRecord(threadId, story.id), story }, events(log));
    await vi.waitFor(() => expect(log).toContainEqual(expect.arrayContaining(["session"])), { timeout: 2000 });
    // In an object, so that the caller does not wait for the end of the run.
    return { done };
  }

  const inboundCalls = (host: ScriptedHost) => host.requests.filter((request) => request.command[2] === "inbound");
  const queue = (threadId = "t1") => readInboundQueue(project.paths, "mini", threadId);

  it("sends a canonical change at the scan, empties the queue, and gives the base the current values", async () => {
    const story = await createStory({ title: "Remote" }, project.ctx);
    const f = setup();
    const { done } = await launch(f, story);

    await updateStory({ id: story.id, title: "Changed on main" }, project.ctx);
    expect(await f.executor.syncHosts()).toEqual(new Map());

    expect((await getStory({ id: story.id }, copyCtx())).title).toBe("Changed on main");
    expect(inboundCalls(f.host)).toHaveLength(1);
    expect(inboundCalls(f.host)[0]?.input).toMatchObject({
      threadId: "t1",
      updates: [{ seq: 1, type: "story.update", storyId: story.id }],
    });
    expect(await queue()).toEqual({ version: 1, nextSeq: 2, updates: [] });
    const current = await buildThreadCopy({ storyId: story.id }, project.ctx);
    expect(await readCopyBase(project.paths, "mini", "t1")).toMatchObject({
      files: current.files,
      attachments: current.attachments,
    });

    expect(await f.executor.syncHosts()).toEqual(new Map());
    expect(inboundCalls(f.host)).toHaveLength(1);

    await f.executor.stop("t1");
    await done;
  });

  it("keeps the updates in the queue while the host is offline, and sends them after the queued cancel on reconnect", async () => {
    const story = await createStory({ title: "Remote" }, project.ctx);
    const other = await createStory({ title: "Other" }, project.ctx);
    const f = setup();
    const { done } = await launch(f, story);
    const { done: stopped } = await launch(f, other, "t2");

    f.host.transport.disconnect();
    await f.executor.cancel("t2");
    await stopped;
    await updateStory({ id: story.id, title: "Changed offline" }, project.ctx);

    expect(await f.executor.syncHosts()).toEqual(new Map());
    expect((await queue()).updates).toMatchObject([{ seq: 1, type: "story.update", storyId: story.id }]);
    expect((await getStory({ id: story.id }, copyCtx())).title).toBe("Remote");

    f.host.transport.reconnect();
    const before = f.host.events.length;
    expect(await f.executor.reconnect("mini")).toBeUndefined();

    const after = f.host.events
      .slice(before)
      .filter((event) => event === "submit:cancel-thread" || event === "inbound");
    expect(after).toEqual(["submit:cancel-thread", "inbound"]);
    expect(f.host.events.slice(before).indexOf("inbound")).toBeLessThan(f.host.events.slice(before).indexOf("attach"));
    expect((await queue()).updates).toEqual([]);
    expect((await getStory({ id: story.id }, copyCtx())).title).toBe("Changed offline");

    await f.executor.stop("t1");
    await done;
  });

  it("sends the same updates again after a lost answer, and each has one effect", async () => {
    const story = await createStory({ title: "Remote" }, project.ctx);
    const lost = { on: true };
    const f = setup({ loseInbound: lost });
    const { done } = await launch(f, story);

    await updateStory({ id: story.id, title: "First", fields: {} }, project.ctx);
    expect(await f.executor.syncHosts()).toEqual(new Map());
    expect((await getStory({ id: story.id }, copyCtx())).title).toBe("First");
    expect((await queue()).updates).toHaveLength(1);

    // The worker changes the title in the copy. The second send of the same update must not overwrite it.
    await updateStory({ id: story.id, title: "Worker" }, copyCtx());
    expect(await f.executor.syncHosts()).toEqual(new Map());

    const sent = inboundCalls(f.host).map((request) => request.input);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect((await queue()).updates).toEqual([]);
    expect((await getStory({ id: story.id }, copyCtx())).title).toBe("Worker");

    await f.executor.stop("t1");
    await done;
  });

  it("uploads the file of a new attachment of the Story of the Thread only when the cache does not have it", async () => {
    const story = await createStory({ title: "Remote" }, project.ctx);
    const f = setup();
    const { done } = await launch(f, story);

    const cached = (await addAttachment({ story: story.id, image: { name: "a.png", bytes: PNG } }, project.ctx)) as {
      id: string;
    };
    const missing = (await addAttachment(
      { story: story.id, image: { name: "b.png", bytes: Buffer.concat([PNG, PNG]) } },
      project.ctx,
    )) as { id: string };
    await hostCachePut(hostPaths(), cached.id, PNG);
    const uploads = f.host.transport.uploads.length;

    expect(await f.executor.syncHosts()).toEqual(new Map());

    expect(f.host.transport.uploads.slice(uploads).map((upload) => upload.command)).toEqual([
      [ROWBLY, "host", "cache-put", "p1", missing.id],
    ]);
    expect((await listAttachments({ story: story.id }, copyCtx())).map((record) => record.id).toSorted()).toEqual(
      [cached.id, missing.id].toSorted(),
    );
    const dir = join(threadPaths(hostPaths(), "t1").copy, ".rowbly/attachments", story.id);
    expect(await readFile(join(dir, `${cached.id}.png`))).toEqual(PNG);
    expect(await readFile(join(dir, `${missing.id}.png`))).toEqual(Buffer.concat([PNG, PNG]));

    await f.executor.stop("t1");
    await done;
  });

  it("drops the waiting updates of a Thread that the host does not have, and of a run that ends", async () => {
    const story = await createStory({ title: "Remote" }, project.ctx);
    const f = setup();
    const { done } = await launch(f, story);

    await rm(threadPaths(hostPaths(), "t1").launch);
    await updateStory({ id: story.id, title: "Changed" }, project.ctx);
    expect(await f.executor.syncHosts()).toEqual(new Map());
    expect(inboundCalls(f.host)).toHaveLength(1);
    expect(await queue()).toEqual({ version: 1, nextSeq: 2, updates: [] });

    await updateStory({ id: story.id, title: "Changed again" }, project.ctx);
    f.host.transport.disconnect();
    expect(await f.executor.syncHosts()).toEqual(new Map());
    expect((await queue()).updates).toMatchObject([{ seq: 2 }]);

    await f.executor.cancel("t1");
    await done;
    expect(await queue()).toEqual({ version: 1, nextSeq: 3, updates: [] });
  });
});
