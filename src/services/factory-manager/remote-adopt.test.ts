import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  InMemoryCredentialStore,
} from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCliShim } from "../../commands/factory-runner/cli-shim.js";
import { createCliShim } from "../../commands/factory-runner/factory-runner.js";
import {
  acquireFactoryOwnership,
  newOwner,
  type Owner,
  releaseFactoryOwnership,
} from "../factory-ownership/factory-ownership.js";
import { HOST_SYNC_REASON } from "../factory-policy/factory-policy.js";
import { updateFactorySettings } from "../factory-settings/factory-settings.js";
import { hostAgentPaths } from "../host-agent/host-agent-paths.js";
import { readHostRun } from "../host-agent/host-run-state.js";
import { createHostRunner } from "../host-agent/host-runner.js";
import { hostProjectId } from "../host-project/host-paths.js";
import { HostUnreachableError } from "../host-transport/host-errors.js";
import type { HostChannel, HostTransport, RemoteCommand } from "../host-transport/host-transport.js";
import { syncOutbox } from "../outbox-apply/outbox-apply.js";
import { loadPi } from "../pi-runtime/pi-runtime.js";
import { initProject } from "../project/project.js";
import { createStage } from "../stage/stage.js";
import { createStory, getStory } from "../story/story.js";
import { createFakeHostAgent, type FakeHostAgent } from "../test-project/fake-host-agent.js";
import { createFakeHostTransport } from "../test-project/fake-host-transport.js";
import { useTempDir } from "../test-project/test-project.js";
import { createThread, getThread, type ThreadRecord, transitionThread } from "../thread/thread.js";
import { projectPaths } from "../workspace/workspace.js";
import { createFactoryManager, type FactoryManager } from "./factory-manager.js";
import type { WorkerHostView } from "./host-slots.js";
import { changeThread, type Manager } from "./manager-state.js";
import { resumeNetworkThreads } from "./network-resume.js";
import { refreshHosts } from "./worker-placement.js";

const captured = vi.hoisted(() => ({ managers: [] as unknown[] }));

vi.mock("./manager-state.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./manager-state.js")>();
  return { ...actual, changeThread: vi.fn(actual.changeThread) };
});
vi.mock("../outbox-apply/outbox-apply.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../outbox-apply/outbox-apply.js")>();
  return { ...actual, syncOutbox: vi.fn(actual.syncOutbox) };
});
// Keeps each manager that starts its heartbeat, so that a test can call a step of the supervisor pass.
vi.mock("./host-heartbeat.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./host-heartbeat.js")>();
  return {
    ...actual,
    startHostHeartbeat: (manager: Manager) => {
      captured.managers.push(manager);
      actual.startHostHeartbeat(manager);
    },
  };
});

const exec = promisify(execFile);
const git = (cwd: string, ...args: string[]) => exec("git", ["-C", cwd, ...args]);
const PROMPT = "Move this Story to Done. Report complete.";
const CLONE = ".local/share/rowbly/projects/remote/repo";
const ROWBLY = "/opt/rowbly/bin/rowbly";
const LAUNCH = {
  executable: process.execPath,
  execArgv: ["--import", resolve("node_modules/tsx/dist/loader.mjs")],
  entry: resolve("src/cli.ts"),
};
const tool = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });

/** A transport of a daemon that can die: after `kill`, each call fails and its channels close without more frames. */
function killable(inner: HostTransport) {
  const state = { dead: false, channels: [] as HostChannel[] };
  const unreachable = () => new HostUnreachableError("Cannot reach fake-host: the daemon died.");
  const alive = () => {
    if (state.dead) throw unreachable();
  };
  const transport: HostTransport = {
    request: async (command, input, options) => {
      alive();
      return inner.request(command, input, options);
    },
    bytes: async (command, input, options) => {
      alive();
      return inner.bytes(command, input, options);
    },
    upload: async (command, data, options) => {
      alive();
      return inner.upload(command, data, options);
    },
    channel: async (command, handlers, options) => {
      alive();
      const channel = await inner.channel(
        command,
        {
          onFrame: (frame) => {
            if (!state.dead) handlers.onFrame(frame);
          },
          onClose: (end) => handlers.onClose(end),
        },
        options,
      );
      state.channels.push(channel);
      return channel;
    },
  };
  return {
    transport,
    kill: () => {
      state.dead = true;
      for (const channel of state.channels) channel.close();
    },
  };
}

/** A transport that records the input of each `submit`, in order. */
function recording(inner: HostTransport, submits: unknown[]): HostTransport {
  return {
    request: (command, input, options) => {
      if (command[2] === "submit") submits.push(input);
      return inner.request(command, input, options);
    },
    bytes: (command, input, options) => inner.bytes(command, input, options),
    upload: (command, data, options) => inner.upload(command, data, options),
    channel: (command, handlers, options) => inner.channel(command, handlers, options),
  };
}

/** A worker response that waits for the gate. */
function gate() {
  let open = () => {};
  const opened = new Promise<void>((resolveGate) => {
    open = resolveGate;
  });
  return { open: () => open(), opened };
}

async function commit(cwd: string, file: string, text: string) {
  await writeFile(join(cwd, file), text);
  await git(cwd, "add", file);
  await git(cwd, "-c", "user.name=Test", "-c", "user.email=t@example.com", "commit", "-q", "-m", file);
}

describe("factory manager that adopts the remote Threads of a previous daemon", () => {
  const dir = useTempDir();
  const managers: FactoryManager[] = [];
  let host: FakeHostAgent | undefined;
  let root: string;
  let home: string;
  let hosts: WorkerHostView[];

  beforeEach(async () => {
    vi.mocked(changeThread).mockClear();
    vi.mocked(syncOutbox).mockClear();
    captured.managers.length = 0;
    hosts = [{ id: "mini", maxWorkers: 1, state: "connected", providers: ["worker"] }];
    root = join(dir.path, "project");
    home = join(dir.path, "home");
    await mkdir(root);
    vi.stubEnv("HOME", home);
    vi.stubEnv("PI_CODING_AGENT_DIR", join(dir.path, "agent"));
    vi.stubEnv("PI_OFFLINE", "1");
    await initProject({ name: "Test", key: "TST" }, { cwd: root });
    await createStage({ label: "Work", key: "WORK", prompt: PROMPT, position: 2 }, { cwd: root });
    await git(dir.path, "init", "-q", root);
    await git(root, "add", ".rowbly");
    await git(root, "-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-q", "-m", "initial");

    const seed = join(dir.path, "seed");
    await mkdir(seed);
    await git(seed, "init", "-q", "-b", "main");
    await commit(seed, "README.md", "seed\n");
    await exec("git", ["clone", "-q", "--bare", seed, join(dir.path, "origin.git")]);
    await exec("git", ["clone", "-q", join(dir.path, "origin.git"), join(home, CLONE)]);
  });

  afterEach(async () => {
    const last = managers.at(-1);
    managers.length = 0;
    await last?.shutdown();
    await host?.stop();
    host = undefined;
    vi.unstubAllEnvs();
  });

  async function setup() {
    const sdk = await loadPi();
    const runtime = await sdk.ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    const worker = fauxProvider({ provider: "worker", api: "worker-faux", tokenSize: { min: 1000, max: 1000 } });
    runtime.registerNativeProvider(worker.provider);
    await updateFactorySettings(
      { maxWorkers: 1, workerModel: { provider: "worker", modelId: worker.getModel().id } },
      { cwd: root },
    );

    const projectId = hostProjectId(root);
    const bin = hostAgentPaths(projectId, home).bin;
    await mkdir(join(bin, ".."), { recursive: true });
    const agent = createFakeHostAgent({
      projectId,
      home,
      runner: createHostRunner({
        paths: hostAgentPaths(projectId, home),
        home,
        shim: await writeCliShim(LAUNCH, bin),
        runtime: async () => ({ runtime, agentDir: join(dir.path, "agent") }),
      }),
    });
    host = agent;
    const shim = await createCliShim(LAUNCH, { cwd: root });

    /** Makes a manager. `ownership` gives a new owner after the death of the previous owner. */
    const start = async (
      connection: (id: string) => HostTransport,
      ownership?: { owner: Owner; deadToken?: string },
    ) => {
      const manager = await createFactoryManager(
        {
          runtime,
          agentDir: join(dir.path, "agent"),
          shim,
          workerHosts: async () => hosts,
          worktreeFacts: async () => undefined,
          hostConnection: async (id) => ({ transport: connection(id), rowbly: ROWBLY, clone: CLONE }),
          hostHeartbeat: { intervalMs: 50, timeoutMs: 5000 },
          remoteStopTimeoutMs: 30_000,
          ...(ownership ? { ownership } : {}),
        },
        { cwd: root },
      );
      managers.push(manager);
      return manager;
    };

    return { worker, agent, start, model: { provider: "worker", modelId: worker.getModel().id } };
  }

  /** Gives the ownership of the Project to a new owner, as after the death of the previous daemon. */
  async function takeOver(previous: FactoryManager) {
    await releaseFactoryOwnership(projectPaths(root), previous.owner.token);
    const owner = await newOwner();
    await acquireFactoryOwnership(projectPaths(root), owner);
    return { owner, deadToken: previous.owner.token };
  }

  function moveAndReport(worker: ReturnType<typeof fauxProvider>, storyId: string, first: FauxResponseStep) {
    worker.setResponses([
      first,
      tool("bash", { command: `rowbly -C "$ROWBLY_ROOT" --json story update ${storyId} --stage DONE` }),
      tool("report_result", { outcome: "complete", summary: "Moved on mini", blockers: [], problems: [] }),
      fauxAssistantMessage("Done"),
    ]);
  }

  /** A first response that waits for the gate, then reads a file. */
  const waitFor =
    (g: ReturnType<typeof gate>): FauxResponseStep =>
    async () => {
      await g.opened;
      return tool("bash", { command: "true" });
    };

  async function threadStatus(id: string, status: ThreadRecord["status"], timeout = 45_000) {
    return vi.waitFor(
      async () => {
        const thread = await getThread(id, { cwd: root });
        expect(thread.status).toBe(status);
        return thread;
      },
      { timeout, interval: 50 },
    );
  }

  function statusCalls(threadId: string, status: ThreadRecord["status"]) {
    return vi
      .mocked(changeThread)
      .mock.calls.filter((call) => call[1] === threadId && call[2] === status && !call[3]?.lastActivityAt);
  }

  async function appliedSeqs(): Promise<number[]> {
    const results = await Promise.allSettled(vi.mocked(syncOutbox).mock.results.map((result) => result.value));
    return results.flatMap((result) =>
      result.status === "fulfilled" ? (result.value as { applied: number[] }).applied : [],
    );
  }

  /** Starts a remote worker with the first manager, and waits until its session opened. */
  async function startFirst(f: Awaited<ReturnType<typeof setup>>, first: FauxResponseStep) {
    const story = await createStory({ title: "Remote", stage: "WORK" }, { cwd: root });
    moveAndReport(f.worker, story.id, first);
    const daemon = killable(f.agent.transport);
    const manager = await f.start(() => daemon.transport);
    const { threadId } = await manager.reserveWorker({
      storyId: story.id,
      stage: "WORK",
      requestId: "r",
      host: "mini",
    });
    await threadStatus(threadId, "running");
    return { story, daemon, manager, threadId };
  }

  async function expectCompletedOnce(threadId: string, storyId: string) {
    const thread = await threadStatus(threadId, "completed");
    expect(thread.result).toMatchObject({ outcome: "complete", summary: "Moved on mini" });
    expect((await getStory({ id: storyId }, { cwd: root })).stage).toBe("DONE");
    await new Promise((r) => setTimeout(r, 300));
    expect(statusCalls(threadId, "completed")).toHaveLength(1);
    expect(statusCalls(threadId, "failed")).toHaveLength(0);
    const applied = await appliedSeqs();
    expect(applied.length).toBeGreaterThan(0);
    expect(new Set(applied).size).toBe(applied.length);
  }

  it("adopts a running remote run after a crash, sends no new command and completes the Thread one time", async () => {
    const f = await setup();
    const g = gate();
    const first = await startFirst(f, waitFor(g));
    first.daemon.kill();
    const calls = f.agent.calls.length;

    const second = await f.start(() => f.agent.transport, await takeOver(first.manager));

    const adopted = await getThread(first.threadId, { cwd: root });
    expect(adopted.status).toBe("running");
    expect(adopted.runs).toHaveLength(1);
    expect(adopted.runs.at(-1)?.ownerToken).toBe(second.owner.token);
    // The adopted Thread uses the slot of its host, and the placement of a new worker counts it.
    const snapshot = await second.snapshot();
    expect(snapshot.hosts.find((entry) => entry.id === "mini")).toMatchObject({ used: 1, free: 0 });
    const other = await createStory({ title: "Other", stage: "WORK" }, { cwd: root });
    await expect(
      second.reserveWorker({ storyId: other.id, stage: "WORK", requestId: "other", host: "mini" }),
    ).rejects.toThrow("Cannot place the worker");
    expect((await second.reconcile()).find((d) => d.story === first.story.id)?.reason).toBe(HOST_SYNC_REASON);

    g.open();
    await expectCompletedOnce(first.threadId, first.story.id);
    const later = f.agent.calls.slice(calls);
    expect(later.some((call) => call[2] === "submit")).toBe(false);
    expect(later.some((call) => call[2] === "runs")).toBe(true);
    await vi.waitFor(async () =>
      expect((await second.snapshot()).hosts.find((entry) => entry.id === "mini")?.used).toBe(0),
    );
  }, 90_000);

  it("completes an adopted Thread one time when its run ended while the daemon was off", async () => {
    const f = await setup();
    const g = gate();
    const first = await startFirst(f, waitFor(g));
    first.daemon.kill();
    g.open();
    await vi.waitFor(async () => expect((await readHostRun(f.agent.paths, first.threadId))?.phase).toBe("ended"), {
      timeout: 45_000,
      interval: 50,
    });
    expect((await getThread(first.threadId, { cwd: root })).status).toBe("running");

    await f.start(() => f.agent.transport, await takeOver(first.manager));

    await expectCompletedOnce(first.threadId, first.story.id);
  }, 90_000);

  /** A response that waits until the session aborts. */
  const blocked: FauxResponseStep = (_context, options) =>
    new Promise((done) => {
      const finish = () => done(fauxAssistantMessage("", { stopReason: "aborted", errorMessage: "Stopped" }));
      if (options?.signal?.aborted) finish();
      options?.signal?.addEventListener("abort", finish, { once: true });
    });

  it("sends the queued stop before `host runs`, and `host runs` before the new channel", async () => {
    const f = await setup();
    const first = await startFirst(f, blocked);
    // The host is not reachable when the first daemon stops: the stop goes in the queue of the host.
    first.daemon.kill();
    await first.manager.shutdown();
    expect((await getThread(first.threadId, { cwd: root })).status).toBe("running");
    const calls = f.agent.calls.length;

    await f.start(() => f.agent.transport);

    const thread = await threadStatus(first.threadId, "interrupted");
    expect(thread.error).toBeUndefined();
    const names = f.agent.calls.slice(calls).map((call: RemoteCommand) => call[2]);
    const submit = names.indexOf("submit");
    const runs = names.indexOf("runs");
    const attach = names.indexOf("attach");
    expect(submit).toBeGreaterThanOrEqual(0);
    expect(runs).toBeGreaterThan(submit);
    expect(attach).toBeGreaterThan(runs);
    expect(statusCalls(first.threadId, "interrupted")).toHaveLength(1);
  }, 90_000);

  it("keeps an adopted Thread while its host is offline, and completes it after the host connects", async () => {
    const f = await setup();
    const g = gate();
    const first = await startFirst(f, waitFor(g));
    first.daemon.kill();
    f.agent.transport.disconnect();

    const second = await f.start(() => f.agent.transport, await takeOver(first.manager));

    await new Promise((r) => setTimeout(r, 300));
    expect((await getThread(first.threadId, { cwd: root })).status).toBe("running");
    expect((await second.reconcile()).find((d) => d.story === first.story.id)?.reason).toBe(HOST_SYNC_REASON);
    expect((await second.snapshot()).hosts.find((entry) => entry.id === "mini")?.used).toBe(1);

    g.open();
    f.agent.transport.reconnect();
    await expectCompletedOnce(first.threadId, first.story.id);
  }, 90_000);

  it("fails an adopted Thread with HOST_RUN_MISSING when its host has no run and no queued launch", async () => {
    const f = await setup();
    const story = await createStory({ title: "Lost", stage: "WORK" }, { cwd: root });
    const thread = await createThread(
      { role: "worker", storyId: story.id, stage: "WORK", ownerToken: "dead", cwd: root, host: "mini" },
      { cwd: root },
    );

    const manager = await f.start(() => f.agent.transport);

    const failed = await threadStatus(thread.id, "failed");
    expect(failed.error).toMatchObject({ code: "HOST_RUN_MISSING" });
    expect(f.agent.calls.some((call) => call[2] === "runs")).toBe(true);
    expect(f.agent.calls.some((call) => call[2] === "submit")).toBe(false);
    await vi.waitFor(async () =>
      expect((await manager.snapshot()).hosts.find((entry) => entry.id === "mini")?.used).toBe(0),
    );
  }, 60_000);

  /** Makes a remote worker Thread that failed with the code NETWORK and can resume. */
  async function networkThread(model: { provider: string; modelId: string }) {
    const story = await createStory({ title: "Offline", stage: "WORK" }, { cwd: root });
    const created = await createThread(
      { role: "worker", storyId: story.id, stage: "WORK", ownerToken: "old", cwd: root, host: "mini", model },
      { cwd: root },
    );
    const thread = await transitionThread(
      created.id,
      {
        expectedRevision: created.revision,
        status: "failed",
        patch: {
          resumable: true,
          session: { id: created.id, file: `sessions/${created.id}/pi.jsonl` },
          worktree: join(dir.path, "not on the main machine"),
          error: { class: "transient", code: "NETWORK", message: "fetch failed" },
        },
      },
      { cwd: root },
    );
    return { story, thread };
  }

  /** The connections of the hosts: `mini` is the fake host agent, `big` only records its calls. */
  function connections(f: Awaited<ReturnType<typeof setup>>, submits: unknown[], bigCalls: RemoteCommand[]) {
    const big = createFakeHostTransport({
      request: (command) => {
        bigCalls.push(command);
        return { exitCode: 1, value: undefined, stderr: "not used" };
      },
    });
    const mini = recording(f.agent.transport, submits);
    return (id: string) => (id === "mini" ? mini : big);
  }

  it("resumes a remote Thread only on its own host", async () => {
    const f = await setup();
    const submits: unknown[] = [];
    const bigCalls: RemoteCommand[] = [];
    hosts = [
      { id: "mini", maxWorkers: 1, state: "disconnected", providers: ["worker"] },
      { id: "big", maxWorkers: 3, state: "connected", providers: ["worker"] },
    ];
    const manager = await f.start(connections(f, submits, bigCalls));
    const { thread } = await networkThread(f.model);
    const runId = thread.runs[0]?.id as string;

    // The own host is disconnected: the resume does not go to a different host.
    await expect(manager.resumeWorker(thread.id, runId, "resume-1")).rejects.toMatchObject({ code: "CONFLICT" });
    // The own host has no free slot.
    hosts = [
      { id: "mini", maxWorkers: 0, state: "connected", providers: ["worker"] },
      { id: "big", maxWorkers: 3, state: "connected", providers: ["worker"] },
    ];
    await expect(manager.resumeWorker(thread.id, runId, "resume-2")).rejects.toThrow("no free slot");
    expect((await getThread(thread.id, { cwd: root })).revision).toBe(thread.revision);

    // The own host is connected with a free slot: the resume goes to it, also when `big` and `local` have more.
    hosts = [
      { id: "mini", maxWorkers: 1, state: "connected", providers: ["worker"] },
      { id: "big", maxWorkers: 3, state: "connected", providers: ["worker"] },
    ];
    await manager.resumeWorker(thread.id, runId, "resume-3");

    await vi.waitFor(
      () => expect(submits).toEqual([expect.objectContaining({ type: "resume", threadId: thread.id })]),
      {
        timeout: 45_000,
        interval: 50,
      },
    );
    expect(bigCalls.filter((call) => call[2] !== "ping")).toEqual([]);
    const resumed = await getThread(thread.id, { cwd: root });
    expect(resumed.runs).toHaveLength(2);
    expect(resumed.host).toBe("mini");
  }, 60_000);

  it("resumes a remote NETWORK Thread on its host only while the host is connected", async () => {
    const f = await setup();
    const submits: unknown[] = [];
    hosts = [{ id: "mini", maxWorkers: 1, state: "disconnected", providers: ["worker"] }];
    await f.start(connections(f, submits, []));
    const manager = captured.managers.at(-1) as Manager;
    const { thread } = await networkThread(f.model);

    await refreshHosts(manager);
    await resumeNetworkThreads(manager);
    expect((await getThread(thread.id, { cwd: root })).runs).toHaveLength(1);

    hosts = [{ id: "mini", maxWorkers: 1, state: "not-ready", providers: ["worker"] }];
    await refreshHosts(manager);
    await resumeNetworkThreads(manager);
    expect((await getThread(thread.id, { cwd: root })).runs).toHaveLength(1);
    expect(submits).toEqual([]);

    hosts = [{ id: "mini", maxWorkers: 1, state: "connected", providers: ["worker"] }];
    await refreshHosts(manager);
    await resumeNetworkThreads(manager);

    expect((await getThread(thread.id, { cwd: root })).runs).toHaveLength(2);
    await vi.waitFor(
      () => expect(submits).toEqual([expect.objectContaining({ type: "resume", threadId: thread.id })]),
      {
        timeout: 45_000,
        interval: 50,
      },
    );
  }, 60_000);
});
