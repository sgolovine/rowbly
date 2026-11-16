import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { addAttachment } from "../attachment/attachment.js";
import type { WorkerEvents } from "../factory-manager/worker-executor.js";
import type { HostRunState } from "../host-agent/host-run-state.js";
import { createStory } from "../story/story.js";
import { createScriptedHost, type ScriptedHost, type ScriptedHostOptions } from "../test-project/scripted-host.js";
import { useTestProject } from "../test-project/test-project.js";
import type { ThreadRecord } from "../thread/thread.js";
import { createRemoteExecutor } from "./remote-executor.js";
import type { RemoteExecutorInput } from "./remote-types.js";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const MODEL = { provider: "worker", modelId: "faux" };
const ROWBLY = "/opt/rowbly/bin/rowbly";
const USAGE = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.1 };
const RESULT = { outcome: "complete", summary: "Done", blockers: [], problems: [] };

function threadRecord(storyId: string, runs = 1): ThreadRecord {
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
    runs: Array.from({ length: runs }, (_, index) => ({
      id: `run-${index}`,
      ownerToken: "owner",
      createdAt,
      status: "pending" as const,
    })),
    resumable: false,
  };
}

/** Records each event, in order. */
function recorder(log: unknown[][]): WorkerEvents {
  const push =
    (name: string) =>
    async (...args: unknown[]) =>
      void log.push([name, ...args]);
  return {
    worktreeReady: push("worktree"),
    sessionOpened: push("session"),
    message: async (...args) => {
      log.push(["message", ...args]);
      return "MESSAGE";
    },
    prompted: () => undefined,
    activity: push("activity"),
    resultReported: push("result"),
    stopping: () => false,
    completed: push("completed"),
    failed: push("failed"),
    finished: push("finished"),
  };
}

const progress = (storyId: string): Partial<HostRunState>[] => {
  const worktree = { path: `/host/repo-worktrees/${storyId}`, branch: `story/${storyId}` };
  const session = { model: MODEL, file: "sessions/t1/s.jsonl" };
  const activity = { lastActivityAt: "2026-01-01T00:00:00.000Z", lastTool: "bash", usage: USAGE };
  return [
    { phase: "starting" },
    { phase: "starting", worktree },
    { phase: "running", worktree, session },
    { phase: "running", worktree, session },
    { phase: "running", worktree, session, activity },
    { phase: "running", worktree, session, activity, result: RESULT },
  ];
};

describe("remote executor", () => {
  const project = useTestProject();

  function setup(options: ScriptedHostOptions = {}, sync: RemoteExecutorInput["sync"] = async () => undefined) {
    const host = createScriptedHost(options);
    const log: unknown[][] = [];
    const executor = createRemoteExecutor({
      paths: project.paths,
      ctx: project.ctx,
      projectId: "p1",
      connect: async () => ({ transport: host.transport, rowbly: ROWBLY, clone: "repo" }),
      maxWorkers: () => 2,
      model: (launch) => launch.thread.model ?? MODEL,
      sync: async (name) => {
        log.push(["sync", name]);
        await sync(name);
      },
      helloTimeoutMs: 2000,
    });
    return { host, log, executor, events: recorder(log) };
  }

  /** Sends the progress frames and then the end, when the host gets the launch command. */
  function script(storyId: string, end: Partial<HostRunState>) {
    return (command: { type: string; threadId: string }, host: ScriptedHost) => {
      if (command.type !== "launch" && command.type !== "resume") return;
      const frames = progress(storyId);
      for (const frame of frames) host.sendRun(command.threadId, frame);
      host.sendRun(command.threadId, { ...frames.at(-1), phase: "ended", usage: USAGE, ...end });
    };
  }

  it("sends the copy, only the missing attachments and the message, then maps the frames to events", async () => {
    const story = await createStory({ title: "Remote" }, project.ctx);
    const own = await addAttachment({ story: story.id, image: { name: "a.png", bytes: PNG } }, project.ctx);
    const second = await addAttachment({ story: story.id, image: { name: "b.png", bytes: PNG } }, project.ctx);
    const ids = [own, second].map((attachment) => (attachment as { id: string }).id);
    const f = setup({ missing: [ids[1] as string], onSubmit: script(story.id, { endReason: "completed" }) });

    await f.executor.launch({ thread: threadRecord(story.id), story }, f.events);

    expect(f.host.requests.map((request) => request.command.slice(2, 3)[0])).toEqual([
      "cache-missing",
      "run-paths",
      "prepare",
      "serve",
      "submit",
    ]);
    expect(f.host.requests[0]?.command).toEqual([ROWBLY, "host", "cache-missing", "p1"]);
    expect(f.host.requests[0]?.input).toEqual({ ids });
    expect(f.host.transport.uploads.map((upload) => upload.command)).toEqual([
      [ROWBLY, "host", "cache-put", "p1", ids[1]],
    ]);
    expect(f.host.requests[1]?.input).toEqual({ threadId: "t1", storyId: story.id, clone: "repo" });
    expect(f.host.requests[2]?.input).toMatchObject({
      threadId: "t1",
      storyId: story.id,
      clone: "repo",
      model: MODEL,
      message: "MESSAGE",
      thread: { id: "t1", host: "mini" },
      copy: { attachments: expect.arrayContaining([expect.objectContaining({ id: ids[1] })]) },
    });
    expect(f.host.requests[3]).toEqual({
      command: [ROWBLY, "host", "serve", "--detach"],
      input: { projectId: "p1", maxWorkers: 2 },
    });
    expect(f.host.commands).toEqual([{ version: 1, id: expect.any(String), type: "launch", threadId: "t1" }]);

    const frames = progress(story.id).at(-1) as HostRunState;
    expect(f.log).toEqual([
      [
        "message",
        `/host/repo-worktrees/${story.id}`,
        MODEL,
        {
          root: "/host/agent/threads/t1/copy",
          shim: "/host/agent/bin/rowbly",
          lock: "/host/agent/threads/t1/write.lock",
          checks: false,
        },
      ],
      ["worktree", frames.worktree],
      ["session", frames.session],
      ["activity", frames.activity],
      ["result", RESULT],
      ["sync", "mini"],
      ["completed", RESULT, undefined],
      ["finished", { ...frames.activity, usage: USAGE }],
    ]);

    const base = join(project.paths.runtimeDir, "hosts", "mini", "threads", "t1", "base.json");
    const content = JSON.parse(await readFile(base, "utf8"));
    expect(content).toMatchObject({ version: 1, threadId: "t1", host: "mini" });
    const prepared = f.host.requests[2]?.input as { copy: { files: unknown } };
    expect(content.files).toEqual(prepared.copy.files);
    expect(content.attachments).toHaveLength(2);
    expect((await stat(base)).mode & 0o777).toBe(0o600);
    expect((await stat(join(base, ".."))).mode & 0o777).toBe(0o700);
    expect(f.host.transport.openChannels).toBe(0);
  });

  it.each([
    [
      "failed",
      { endReason: "failed", failure: { code: "HOST_NO_FREE_SLOT", message: "No slot", sessionOpened: true } },
      [
        "failed",
        { error: expect.objectContaining({ code: "HOST_NO_FREE_SLOT", message: "No slot" }), sessionOpened: true },
      ],
    ],
    ["stopped", { endReason: "stopped" }, ["completed", RESULT, "stopped"]],
    ["cancelled", { endReason: "cancelled" }, ["completed", RESULT, "cancelled"]],
  ] as const)("maps the end reason %s", async (_name, end, expected) => {
    const story = await createStory({ title: "Remote" }, project.ctx);
    const f = setup({ onSubmit: script(story.id, end as Partial<HostRunState>) });

    await f.executor.launch({ thread: threadRecord(story.id), story }, f.events);

    const ends = f.log.filter((entry) => ["completed", "failed"].includes(entry[0] as string));
    expect(ends).toEqual([expected]);
    expect(f.log.at(-1)?.[0]).toBe("finished");
  });

  it("waits after a failed sync until syncHosts applies the outbox", async () => {
    const story = await createStory({ title: "Remote" }, project.ctx);
    const failing = { on: true };
    const f = setup({ onSubmit: script(story.id, { endReason: "completed" }) }, async () => {
      if (failing.on) throw new Error("Cannot reach mini");
    });

    const done = f.executor.launch({ thread: threadRecord(story.id), story }, f.events);
    await vi.waitFor(() => expect(f.log.some((entry) => entry[0] === "sync")).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(f.log.some((entry) => entry[0] === "completed")).toBe(false);

    expect(await f.executor.syncHosts()).toEqual(new Map([["mini", "Cannot reach mini"]]));
    expect(f.log.some((entry) => entry[0] === "completed")).toBe(false);

    failing.on = false;
    expect(await f.executor.syncHosts()).toEqual(new Map());
    await done;
    expect(f.log.filter((entry) => entry[0] === "completed")).toEqual([["completed", RESULT, undefined]]);
  });

  const queueFile = () => join(project.paths.runtimeDir, "hosts", "mini", "commands.json");
  const readQueue = async () => JSON.parse(await readFile(queueFile(), "utf8"));
  const pending = (done: Promise<void>) =>
    Promise.race([done.then(() => "done"), new Promise((r) => setTimeout(() => r("wait"), 50))]);

  it("keeps the wait of a stopped run while the host is disconnected, and the reconnect sends the stop first", async () => {
    const story = await createStory({ title: "Remote" }, project.ctx);
    const f = setup({
      onSubmit: (command, host) => {
        if (command.type === "launch") host.sendRun(command.threadId, { phase: "running" });
      },
    });

    const done = f.executor.launch({ thread: threadRecord(story.id), story }, f.events);
    await vi.waitFor(() => expect(f.host.commands).toHaveLength(1));
    f.host.transport.disconnect();
    await vi.waitFor(() => expect(f.host.transport.openChannels).toBe(0));
    expect(await pending(done)).toBe("wait");

    await f.executor.stop("t1");
    expect(await pending(done)).toBe("wait");
    expect(await readQueue()).toEqual({
      version: 1,
      commands: [{ id: expect.any(String), type: "stop-thread", threadId: "t1", queuedAt: expect.any(String) }],
    });
    expect((await stat(queueFile())).mode & 0o777).toBe(0o600);
    expect((await stat(join(queueFile(), ".."))).mode & 0o777).toBe(0o700);
    expect(f.host.commands.map((command) => command.type)).toEqual(["launch"]);

    // The heartbeat fails while the host is offline; the reconnect does nothing and keeps the queue.
    expect(await f.executor.reconnect("mini")).toEqual(expect.stringContaining("Cannot reach"));
    expect((await readQueue()).commands).toHaveLength(1);

    f.host.transport.reconnect();
    const events = f.host.events.length;
    expect(await f.executor.reconnect("mini")).toBeUndefined();
    expect(f.host.events.slice(events)).toEqual(["submit:stop-thread", "attach"]);
    expect((await readQueue()).commands).toEqual([]);

    f.host.sendRun("t1", { phase: "ended", endReason: "stopped" });
    await done;
    expect(f.log.filter((entry) => ["completed", "failed"].includes(entry[0] as string))).toEqual([
      ["completed", undefined, "stopped"],
    ]);
    expect(await f.executor.reconnect("mini")).toBeUndefined();
    expect(f.host.transport.openChannels).toBe(0);
  });

  it("queues a cancel while the host is disconnected and ends the wait without an event", async () => {
    const story = await createStory({ title: "Remote" }, project.ctx);
    const f = setup();

    const done = f.executor.launch({ thread: threadRecord(story.id), story }, f.events);
    await vi.waitFor(() => expect(f.host.commands).toHaveLength(1));
    f.host.transport.disconnect();
    await f.executor.cancel("t1");
    await done;

    expect((await readQueue()).commands.map((command: { type: string }) => command.type)).toEqual(["cancel-thread"]);
    expect(f.log.filter((entry) => ["completed", "failed", "finished"].includes(entry[0] as string))).toEqual([]);

    f.host.transport.reconnect();
    expect(await f.executor.reconnect("mini")).toBeUndefined();
    expect(f.host.commands.map((command) => command.type)).toEqual(["launch", "cancel-thread"]);
    expect(f.host.events.at(-1)).toBe("submit:cancel-thread");
    expect((await readQueue()).commands).toEqual([]);
  });

  it("queues the launch with the same id when its answer is lost, and the reconnect sends it again", async () => {
    const story = await createStory({ title: "Remote" }, project.ctx);
    const lost = { on: true };
    const f = setup({
      loseAnswer: (command, host) => {
        if (command.type !== "launch" || !lost.on) return false;
        lost.on = false;
        host.transport.disconnect();
        return true;
      },
    });

    const done = f.executor.launch({ thread: threadRecord(story.id), story }, f.events);
    await vi.waitFor(async () => expect((await readQueue()).commands).toHaveLength(1));
    const [queued] = (await readQueue()).commands;
    expect(queued).toMatchObject({ type: "launch", threadId: "t1", id: f.host.commands[0]?.id });
    expect(await pending(done)).toBe("wait");

    f.host.transport.reconnect();
    expect(await f.executor.reconnect("mini")).toBeUndefined();
    expect(f.host.commands.map((command) => [command.type, command.id])).toEqual([
      ["launch", queued.id],
      ["launch", queued.id],
    ]);
    expect((await readQueue()).commands).toEqual([]);

    for (const frame of progress(story.id)) f.host.sendRun("t1", frame);
    f.host.sendRun("t1", { ...progress(story.id).at(-1), phase: "ended", endReason: "completed", usage: USAGE });
    await done;
    expect(f.log.filter((entry) => ["completed", "failed"].includes(entry[0] as string))).toEqual([
      ["completed", RESULT, undefined],
    ]);
    expect(f.log.filter((entry) => entry[0] === "result")).toHaveLength(1);
  });

  it("drops a queued launch when the run is stopped, and ends the wait", async () => {
    const story = await createStory({ title: "Remote" }, project.ctx);
    const f = setup({
      loseAnswer: (command, host) => {
        if (command.type !== "launch") return false;
        host.transport.disconnect();
        return true;
      },
    });

    const done = f.executor.launch({ thread: threadRecord(story.id), story }, f.events);
    await vi.waitFor(async () => expect((await readQueue()).commands).toHaveLength(1));
    await f.executor.stop("t1");
    await done;

    expect((await readQueue()).commands.map((command: { type: string }) => command.type)).toEqual(["stop-thread"]);
    expect(f.log.filter((entry) => ["completed", "failed"].includes(entry[0] as string))).toEqual([]);
  });

  it("fails the launch with the host error when the connection is cut before the launch submit", async () => {
    const story = await createStory({ title: "Remote" }, project.ctx);
    const f = setup();
    const request = f.host.transport.request.bind(f.host.transport);
    f.host.transport.request = async (command, input, options) => {
      if (command[2] === "serve") f.host.transport.disconnect();
      return request(command, input, options);
    };

    await f.executor.launch({ thread: threadRecord(story.id), story }, f.events);

    expect(f.log.at(-1)).toEqual([
      "failed",
      { error: expect.objectContaining({ code: "HOST_UNREACHABLE" }), sessionOpened: false },
    ]);
    expect(f.host.commands).toEqual([]);
    await expect(readQueue()).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("stops each run for a factory stop: it waits on a connected host and queues the stop for a disconnected host", async () => {
    const story = await createStory({ title: "Remote" }, project.ctx);
    const connected = setup({
      onSubmit: (command, host) => {
        if (command.type === "stop-thread") host.sendRun(command.threadId, { phase: "ended", endReason: "stopped" });
      },
    });
    const done = connected.executor.launch({ thread: threadRecord(story.id), story }, connected.events);
    await vi.waitFor(() => expect(connected.host.commands).toHaveLength(1));
    await connected.executor.shutdown(5000);
    await done;
    expect(connected.host.commands.map((command) => command.type)).toEqual(["launch", "stop-thread"]);
    expect(connected.log.filter((entry) => entry[0] === "completed")).toEqual([["completed", undefined, "stopped"]]);

    const offline = setup();
    const waiting = offline.executor.launch({ thread: threadRecord(story.id), story }, offline.events);
    await vi.waitFor(() => expect(offline.host.commands).toHaveLength(1));
    offline.host.transport.disconnect();
    await offline.executor.shutdown(60_000);
    await waiting;
    expect((await readQueue()).commands.map((command: { type: string }) => command.type)).toEqual(["stop-thread"]);
    expect(offline.log.filter((entry) => ["completed", "failed"].includes(entry[0] as string))).toEqual([]);

    // A connected host that does not end the run in the time limit ends the wait.
    const slow = setup();
    const slowRun = slow.executor.launch({ thread: threadRecord(story.id), story }, slow.events);
    await vi.waitFor(() => expect(slow.host.commands).toHaveLength(1));
    await slow.executor.shutdown(20);
    await slowRun;
    expect(slow.host.commands.map((command) => command.type)).toEqual(["launch", "stop-thread"]);
  });

  it("submits stop-thread and cancel-thread to the host, and refuses a steering message", async () => {
    const story = await createStory({ title: "Remote" }, project.ctx);
    const f = setup({
      onSubmit: (command, host) => {
        if (command.type === "stop-thread") host.sendRun(command.threadId, { phase: "ended", endReason: "stopped" });
      },
    });

    const done = f.executor.launch({ thread: threadRecord(story.id), story }, f.events);
    await vi.waitFor(() => expect(f.host.commands).toHaveLength(1));
    await expect(f.executor.steer("t1", "hello")).rejects.toMatchObject({ code: "CONFLICT" });
    await f.executor.cancel("t1");
    await f.executor.stop("t1");
    await done;

    expect(f.host.commands.map((command) => command.type)).toEqual(["launch", "cancel-thread", "stop-thread"]);
    expect(f.log.filter((entry) => entry[0] === "completed")).toEqual([["completed", undefined, "stopped"]]);
  });

  it("fails the run for a rejected receipt, submits resume for a Thread with more runs, and checks the hello", async () => {
    const story = await createStory({ title: "Remote" }, project.ctx);
    const rejected = setup({
      receipt: (command) => ({
        version: 1,
        id: command.id,
        ownerToken: "x",
        status: "rejected",
        error: { code: "NOT_FOUND", message: "Thread t1 has no session file" },
      }),
    });

    await rejected.executor.launch({ thread: threadRecord(story.id, 2), story }, rejected.events);

    expect(rejected.host.commands.map((command) => command.type)).toEqual(["resume"]);
    expect(rejected.log.at(-1)).toEqual([
      "failed",
      { error: expect.objectContaining({ code: "NOT_FOUND" }), sessionOpened: false },
    ]);

    const old = setup({ versions: { protocol: 0, rowbly: "0.0.0" } });
    await old.executor.launch({ thread: threadRecord(story.id), story }, old.events);
    expect(old.log.at(-1)).toEqual([
      "failed",
      { error: expect.objectContaining({ code: "HOST_VERSION_MISMATCH" }), sessionOpened: false },
    ]);
    expect(old.host.commands).toEqual([]);
  });
});
