import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
import { getThreadLog } from "../conversation/conversation.js";
import { HOST_SYNC_REASON } from "../factory-policy/factory-policy.js";
import { updateFactorySettings } from "../factory-settings/factory-settings.js";
import { updateFactoryState } from "../factory-state/factory-state.js";
import { hostAgentPaths } from "../host-agent/host-agent-paths.js";
import { readHostRun } from "../host-agent/host-run-state.js";
import { createHostRunner } from "../host-agent/host-runner.js";
import { hostProjectId } from "../host-project/host-paths.js";
import { HostUnreachableError } from "../host-transport/host-errors.js";
import type { HostTransport } from "../host-transport/host-transport.js";
import { readOutboxEntries } from "../outbox/outbox-file.js";
import { syncOutbox } from "../outbox-apply/outbox-apply.js";
import { loadPi } from "../pi-runtime/pi-runtime.js";
import { initProject } from "../project/project.js";
import { createStage } from "../stage/stage.js";
import { createStory, getStory } from "../story/story.js";
import { promptHash } from "../supervisor-digest/supervisor-digest.js";
import { createFakeHostAgent, type FakeHostAgent } from "../test-project/fake-host-agent.js";
import { useTempDir } from "../test-project/test-project.js";
import { getThread, type ThreadRecord } from "../thread/thread.js";
import { createFactoryManager, type FactoryManager } from "./factory-manager.js";
import { changeThread, type Manager } from "./manager-state.js";
import { createSupervisorTools } from "./supervisor-tools.js";

vi.mock("./manager-state.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./manager-state.js")>();
  return { ...actual, changeThread: vi.fn(actual.changeThread) };
});
vi.mock("../outbox-apply/outbox-apply.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../outbox-apply/outbox-apply.js")>();
  return { ...actual, syncOutbox: vi.fn(actual.syncOutbox) };
});

const exec = promisify(execFile);
const git = (cwd: string, ...args: string[]) => exec("git", ["-C", cwd, ...args]);
const PROMPT = "Move this Story to Done. Report complete.";
const CLONE = ".local/share/rowbly/projects/remote/repo";
const ROWBLY = "/opt/rowbly/bin/rowbly";
const HOSTS = [{ id: "mini", maxWorkers: 1, state: "connected" as const, providers: ["worker"] }];
const LAUNCH = {
  executable: process.execPath,
  execArgv: ["--import", resolve("node_modules/tsx/dist/loader.mjs")],
  entry: resolve("src/cli.ts"),
};
const tool = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });

/** The step of a run at which the test cuts the connection. */
type Cut =
  | "launch-submit"
  | "after-launch"
  | "worktree"
  | "session"
  | "session-lines"
  | "result"
  | "end"
  | "outbox-sync";

interface RunFrame {
  readonly type?: string;
  readonly run?: { worktree?: unknown; session?: unknown; result?: unknown; phase?: string };
}

/** True when the frame is the first frame of the step. */
function frameStep(frame: RunFrame, cut: Cut): boolean {
  const run = frame.run;
  if (cut === "session-lines") return frame.type === "session";
  if (frame.type !== "run" || !run) return false;
  if (cut === "worktree") return !!run.worktree;
  if (cut === "session") return !!run.session;
  if (cut === "result") return !!run.result;
  return cut === "end" && run.phase === "ended";
}

/** A transport that cuts the connection of the fake host one time, at the step of the run. */
function cutting(inner: FakeHostAgent["transport"], cut: Cut | "before-submit"): HostTransport {
  const fired = { value: false };
  const fire = () => {
    if (fired.value) return false;
    fired.value = true;
    inner.disconnect();
    return true;
  };

  return {
    request: async (command, input, options) => {
      const name = command[2];
      if (name === "serve" && cut === "before-submit") fire();
      const result = await inner.request(command, input, options);
      if (name === "outbox" && cut === "outbox-sync" && (result.value as { entries: unknown[] }).entries.length > 0) {
        fire();
      }
      if (name === "submit" && (input as { type: string }).type === "launch") {
        if (cut === "launch-submit" && fire())
          throw new HostUnreachableError("Cannot reach fake-host: Connection closed.");
        if (cut === "after-launch") fire();
      }
      return result;
    },
    bytes: (command, input, options) => inner.bytes(command, input, options),
    upload: (command, data, options) => inner.upload(command, data, options),
    channel: (command, handlers, options) =>
      inner.channel(
        command,
        {
          onFrame: (frame) => {
            handlers.onFrame(frame);
            if (cut !== "before-submit" && frameStep(frame as RunFrame, cut)) fire();
          },
          onClose: (end) => handlers.onClose(end),
        },
        options,
      ),
  };
}

async function commit(cwd: string, file: string, text: string) {
  await writeFile(join(cwd, file), text);
  await git(cwd, "add", file);
  await git(cwd, "-c", "user.name=Test", "-c", "user.email=t@example.com", "commit", "-q", "-m", file);
}

describe("factory manager with a worker host that disconnects", () => {
  const dir = useTempDir();
  let manager: FactoryManager | undefined;
  let host: FakeHostAgent | undefined;
  let root: string;
  let home: string;

  beforeEach(async () => {
    vi.mocked(changeThread).mockClear();
    vi.mocked(syncOutbox).mockClear();
    root = join(dir.path, "project");
    home = join(dir.path, "home");
    await mkdir(root);
    vi.stubEnv("HOME", home);
    vi.stubEnv("PI_CODING_AGENT_DIR", join(dir.path, "agent"));
    vi.stubEnv("PI_OFFLINE", "1");
    await initProject({ name: "Test", key: "TST" }, { cwd: root });
    await createStage({ label: "Work", key: "WORK", prompt: PROMPT }, { cwd: root });
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
    host?.transport.reconnect();
    await manager?.shutdown();
    await host?.stop();
    manager = undefined;
    host = undefined;
    vi.unstubAllEnvs();
  });

  async function fixture(cut: Cut | "before-submit" | undefined) {
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
    await updateFactoryState(root, (state) => ({
      ...state,
      prompts: { WORK: { hash: promptHash(PROMPT), class: "work" } },
    }));

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
    const transport = cut ? cutting(agent.transport, cut) : agent.transport;
    host = agent;
    manager = await createFactoryManager(
      {
        runtime,
        agentDir: join(dir.path, "agent"),
        shim: await createCliShim(LAUNCH, { cwd: root }),
        workerHosts: async () => HOSTS,
        worktreeFacts: async () => undefined,
        hostConnection: async () => ({ transport, rowbly: ROWBLY, clone: CLONE }),
        hostHeartbeat: { intervalMs: 50, timeoutMs: 5000 },
        remoteStopTimeoutMs: 30_000,
      },
      { cwd: root },
    );
    return { manager, worker, host: agent };
  }

  function moveAndReport(worker: ReturnType<typeof fauxProvider>, storyId: string, last?: FauxResponseStep) {
    worker.setResponses([
      tool("bash", { command: `rowbly -C "$ROWBLY_ROOT" --json story update ${storyId} --stage DONE` }),
      tool("report_result", { outcome: "complete", summary: "Moved on mini", blockers: [], problems: [] }),
      last ?? fauxAssistantMessage("Done"),
    ]);
  }

  async function finalThread(id: string, status: ThreadRecord["status"]): Promise<ThreadRecord> {
    return vi.waitFor(
      async () => {
        const thread = await getThread(id, { cwd: root });
        expect(thread.status).toBe(status);
        return thread;
      },
      { timeout: 45_000, interval: 50 },
    );
  }

  async function hostRunEnded(f: { host: FakeHostAgent }, threadId: string) {
    await vi.waitFor(async () => expect((await readHostRun(f.host.paths, threadId))?.phase).toBe("ended"), {
      timeout: 45_000,
      interval: 50,
    });
  }

  /** The changes to the status, without the later activity writes that keep the status. */
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

  async function reserve(f: { manager: FactoryManager }, storyId: string) {
    const { threadId } = await f.manager.reserveWorker({ storyId, stage: "WORK", requestId: "r", host: "mini" });
    return threadId;
  }

  it.each(["launch-submit", "after-launch", "worktree", "session", "result", "end", "outbox-sync"] as const)(
    "completes the Thread one time after a cut at the step %s and a reconnect",
    async (cut) => {
      const f = await fixture(cut);
      const story = await createStory({ title: "Remote", stage: "WORK" }, { cwd: root });
      moveAndReport(f.worker, story.id);

      const threadId = await reserve(f, story.id);
      await vi.waitFor(() => expect(f.host.transport.connected).toBe(false), { timeout: 45_000, interval: 20 });
      await hostRunEnded(f, threadId);

      if (cut !== "outbox-sync") {
        // While the host is disconnected, the Thread keeps its status and the Story waits for the host sync.
        await new Promise((r) => setTimeout(r, 300));
        const waiting = await getThread(threadId, { cwd: root });
        expect(["pending", "running"]).toContain(waiting.status);
        if (["session", "result", "end"].includes(cut)) expect(waiting.status).toBe("running");
        expect((await f.manager.reconcile()).find((d) => d.story === story.id)?.reason).toBe(HOST_SYNC_REASON);
        expect((await f.manager.snapshot()).hosts[1]?.state).not.toBe("connected");
        expect((await getStory({ id: story.id }, { cwd: root })).stage).toBe("WORK");
      }

      f.host.transport.reconnect();
      const thread = await finalThread(threadId, "completed");

      expect(thread.result).toMatchObject({ outcome: "complete", summary: "Moved on mini" });
      expect(thread.result?.problems).not.toContain("Story remains in the assigned Stage");
      expect((await getStory({ id: story.id }, { cwd: root })).stage).toBe("DONE");
      await new Promise((r) => setTimeout(r, 300));
      expect(statusCalls(threadId, "completed")).toHaveLength(1);
      expect(statusCalls(threadId, "failed")).toHaveLength(0);
      expect(statusCalls(threadId, "interrupted")).toHaveLength(0);
      const results = vi
        .mocked(changeThread)
        .mock.calls.filter((call) => call[1] === threadId && call[2] === "running" && call[3]?.result);
      expect(results).toHaveLength(1);

      // Each outbox entry is applied one time, also by a later sync.
      const source = await import("../outbox-apply/outbox-source.js");
      const later = await syncOutbox(
        {
          host: "mini",
          source: source.transportOutboxSource({
            transport: f.host.transport,
            rowbly: ROWBLY,
            projectId: hostProjectId(root),
          }),
        },
        { cwd: root },
      );
      expect(later.applied).toEqual([]);
      const applied = await appliedSeqs();
      expect(applied.length).toBeGreaterThan(0);
      expect(new Set(applied).size).toBe(applied.length);
      expect(await readOutboxEntries(f.host.paths.outbox, 0)).toEqual([]);

      if (cut === "launch-submit") {
        const launches = f.host.calls.filter((call) => call[2] === "submit");
        expect(launches.length).toBeGreaterThanOrEqual(2);
      }
      expect(
        await readFile(join(root, ".rowbly/runtime/hosts/mini/commands.json"), "utf8").catch(() => "{}"),
      ).not.toContain(threadId);
    },
    90_000,
  );

  it("mirrors the session for Peek and inspect_worker across a disconnect and a reconnect", async () => {
    const f = await fixture("session-lines");
    const story = await createStory({ title: "Remote", stage: "WORK" }, { cwd: root });
    moveAndReport(f.worker, story.id);

    const threadId = await reserve(f, story.id);
    await vi.waitFor(() => expect(f.host.transport.connected).toBe(false), { timeout: 45_000, interval: 20 });
    const sessionFile = await vi.waitFor(
      async () => {
        const file = (await getThread(threadId, { cwd: root })).session.file;
        expect(file).toMatch(new RegExp(`^sessions/${threadId}/.+\\.jsonl$`));
        return file as string;
      },
      { timeout: 10_000, interval: 20 },
    );
    const mirror = join(root, ".rowbly/runtime", sessionFile);
    const hostSession = join(f.host.paths.runtime, sessionFile);
    await vi.waitFor(async () => expect((await readFile(mirror)).length).toBeGreaterThan(0), {
      timeout: 10_000,
      interval: 20,
    });
    await hostRunEnded(f, threadId);

    // While the host is offline, the mirror has the lines that arrived before the cut, and the host has more.
    const offline = await readFile(mirror, "utf8");
    const full = await readFile(hostSession, "utf8");
    expect(full.startsWith(offline)).toBe(true);
    expect(full.length).toBeGreaterThan(offline.length);
    const log = await getThreadLog(threadId, { tail: 20 }, { cwd: root });
    expect(log.status).toBe("ok");
    expect(log.entries.length).toBeGreaterThan(0);
    const inspect = createSupervisorTools({ ctx: { cwd: root } } as unknown as Manager).find(
      (tool) => tool.name === "inspect_worker",
    );
    const inspected = await inspect?.execute("call", { threadId, history: true } as never);
    const answer = JSON.parse(inspected?.content[0]?.text ?? "{}");
    expect(answer.thread.id).toBe(threadId);
    expect(answer.history).toContain('"status":"ok"');
    expect(answer.history).toContain('"entries":[{');

    f.host.transport.reconnect();
    await finalThread(threadId, "completed");

    // After the reconnect, the mirror equals the session file of the host, with no duplicate line and no gap.
    expect(await readFile(mirror, "utf8")).toBe(await readFile(hostSession, "utf8"));
    const after = await getThreadLog(threadId, { tail: 50 }, { cwd: root });
    expect(after.entries.length).toBeGreaterThan(log.entries.length);
    expect(f.host.calls.some((call) => call[2] === "session-bytes")).toBe(true);
  }, 90_000);

  it("fails the Thread one time with the host error code when the cut comes before the launch submit", async () => {
    const f = await fixture("before-submit");
    const story = await createStory({ title: "Remote", stage: "WORK" }, { cwd: root });
    moveAndReport(f.worker, story.id);

    const threadId = await reserve(f, story.id);
    const thread = await finalThread(threadId, "failed");

    expect(thread.error).toMatchObject({ code: "HOST_UNREACHABLE", class: "launch" });
    expect(statusCalls(threadId, "failed")).toHaveLength(1);
    expect(f.host.calls.some((call) => call[2] === "submit")).toBe(false);
    expect(await readHostRun(f.host.paths, threadId)).toBeUndefined();
    expect((await f.manager.snapshot()).providers).toEqual({});
  }, 60_000);

  /** A response that waits until the session aborts. */
  const blocked: FauxResponseStep = (_context, options) =>
    new Promise((done) => {
      const finish = () => done(fauxAssistantMessage("", { stopReason: "aborted", errorMessage: "Stopped" }));
      if (options?.signal?.aborted) finish();
      options?.signal?.addEventListener("abort", finish, { once: true });
    });

  it("stops a run on a connected host for a factory stop, waits for its end and applies its outbox", async () => {
    const f = await fixture(undefined);
    const story = await createStory({ title: "Remote", stage: "WORK" }, { cwd: root });
    f.worker.setResponses([
      tool("bash", { command: `rowbly -C "$ROWBLY_ROOT" --json story update ${story.id} --stage DONE` }),
      blocked,
    ]);

    const threadId = await reserve(f, story.id);
    await vi.waitFor(async () => expect(await readOutboxEntries(f.host.paths.outbox, 0)).toHaveLength(1), {
      timeout: 45_000,
      interval: 50,
    });
    await vi.waitFor(async () => expect((await getThread(threadId, { cwd: root })).status).toBe("running"), {
      timeout: 10_000,
      interval: 20,
    });

    await f.manager.shutdown();

    const thread = await getThread(threadId, { cwd: root });
    expect(thread.status).toBe("interrupted");
    expect(f.host.calls.filter((call) => call[2] === "submit")).toHaveLength(2);
    expect((await getStory({ id: story.id }, { cwd: root })).stage).toBe("DONE");
  }, 60_000);

  it("queues the stop of a run on a disconnected host for a factory stop, and does not wait", async () => {
    const f = await fixture(undefined);
    const story = await createStory({ title: "Remote", stage: "WORK" }, { cwd: root });
    f.worker.setResponses([blocked]);

    const threadId = await reserve(f, story.id);
    await vi.waitFor(async () => expect((await getThread(threadId, { cwd: root })).status).toBe("running"), {
      timeout: 45_000,
      interval: 20,
    });
    f.host.transport.disconnect();

    const start = Date.now();
    await f.manager.shutdown();

    expect(Date.now() - start).toBeLessThan(10_000);
    expect((await getThread(threadId, { cwd: root })).status).toBe("running");
    const queue = JSON.parse(await readFile(join(root, ".rowbly/runtime/hosts/mini/commands.json"), "utf8"));
    expect(queue.commands).toEqual([expect.objectContaining({ type: "stop-thread", threadId })]);
  }, 60_000);
});
