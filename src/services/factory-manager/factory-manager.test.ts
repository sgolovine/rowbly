import type { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCliShim } from "../../commands/factory-runner/factory-runner.js";
import { ConflictError } from "../errors/errors.js";
import { storyHash } from "../factory-policy/factory-policy.js";
import { getFactorySettings, updateFactorySettings } from "../factory-settings/factory-settings.js";
import { readFactoryState, updateFactoryState } from "../factory-state/factory-state.js";
import { loadPi } from "../pi-runtime/pi-runtime.js";
import { initProject } from "../project/project.js";
import { commitCanonicalProject } from "../project-write/project-write.js";
import { prepareRuntime, runtimePath } from "../runtime-files/runtime-files.js";
import { createStage } from "../stage/stage.js";
import { createStory, deleteStory, getStory, updateStory } from "../story/story.js";
import { useTempDir } from "../test-project/test-project.js";
import { listThreads } from "../thread/thread.js";
import { projectPaths } from "../workspace/workspace.js";
import { createFactoryManager, type FactoryManager } from "./factory-manager.js";
import { getState, readAuthStamp, setState } from "./manager-state.js";
import { scan } from "./manager-status.js";
import { startProjectSync } from "./project-sync-step.js";
import { reserveWorker } from "./worker-reservation.js";

// Marks the async context that holds the state lock, so that a test can find a projectWrite inside it.
const stateLockHeld = vi.hoisted(() => ({ storage: undefined as AsyncLocalStorage<boolean> | undefined, nested: 0 }));
vi.mock("../factory-state/state-file.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../factory-state/state-file.js")>();
  const { AsyncLocalStorage: Storage } = await import("node:async_hooks");
  const storage = new Storage<boolean>();
  stateLockHeld.storage = storage;
  return {
    ...actual,
    withStateLock: <T>(root: string, action: () => Promise<T>) =>
      actual.withStateLock(root, () => storage.run(true, action)),
  };
});
vi.mock("../project-write/project-write.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../project-write/project-write.js")>();
  const projectWrite = <T>(root: string, action: () => Promise<T>, waitSeconds?: number) => {
    if (stateLockHeld.storage?.getStore()) stateLockHeld.nested += 1;
    return actual.projectWrite(root, action, waitSeconds);
  };
  return { ...actual, projectWrite, commitCanonicalProject: vi.fn(actual.commitCanonicalProject) };
});
vi.mock("./manager-state.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./manager-state.js")>();
  return { ...actual, readAuthStamp: vi.fn(actual.readAuthStamp), setState: vi.fn(actual.setState) };
});
vi.mock("./manager-status.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./manager-status.js")>();
  return { ...actual, scan: vi.fn(actual.scan) };
});
vi.mock("./project-sync-step.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./project-sync-step.js")>();
  return { ...actual, startProjectSync: vi.fn(actual.startProjectSync) };
});
vi.mock("./worker-reservation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./worker-reservation.js")>();
  return { ...actual, reserveWorker: vi.fn(actual.reserveWorker) };
});
vi.mock("../factory-settings/factory-settings.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../factory-settings/factory-settings.js")>();
  return { ...actual, getFactorySettings: vi.fn(actual.getFactorySettings) };
});

const exec = promisify(execFile);
const fail = (): never => {
  throw new Error("y".repeat(1000));
};
const tool = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
describe("foreground factory", () => {
  const dir = useTempDir();
  let manager: FactoryManager | undefined;
  let root: string;
  beforeEach(async () => {
    root = join(dir.path, "project with ' spaces");
    await mkdir(root);
    vi.stubEnv("HOME", join(dir.path, "home"));
    vi.stubEnv("PI_CODING_AGENT_DIR", join(dir.path, "agent"));
    vi.stubEnv("PI_OFFLINE", "1");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Unexpected network");
      }),
    );
    await initProject({ name: "Test", key: "TST" }, { cwd: root });
    await createStage(
      { label: "Work", key: "WORK", prompt: "Move this Story to Done. Report complete.", position: 2 },
      { cwd: root },
    );
    await exec("git", ["init", root]);
    await exec("git", ["-C", root, "add", ".rowbly"]);
    await exec("git", [
      "-C",
      root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "initial",
    ]);
  });
  afterEach(async () => {
    await manager?.shutdown();
    manager = undefined;
    for (const mocked of [commitCanonicalProject, readAuthStamp, scan, startProjectSync, getFactorySettings])
      vi.mocked(mocked).mockReset();
    vi.mocked(reserveWorker).mockReset();
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  async function fixture(
    beforeLaunch?: Parameters<typeof createFactoryManager>[0]["beforeLaunch"],
    extra: Partial<Parameters<typeof createFactoryManager>[0]> = {},
  ) {
    const sdk = await loadPi();
    const runtime = await sdk.ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    // A second worker provider, for the tests of model overrides and pauses. No supervisor provider exists.
    const spare = fauxProvider({ provider: "spare", api: "spare-faux", tokenSize: { min: 1000, max: 1000 } });
    const worker = fauxProvider({ provider: "worker", api: "worker-faux", tokenSize: { min: 1000, max: 1000 } });
    runtime.registerNativeProvider(spare.provider);
    runtime.registerNativeProvider(worker.provider);
    await updateFactorySettings(
      {
        maxWorkers: 1,
        workerModel: { provider: worker.getModel().provider, modelId: worker.getModel().id },
      },
      { cwd: root },
    );
    const shim = await createCliShim(
      {
        executable: process.execPath,
        execArgv: ["--import", resolve("node_modules/tsx/dist/loader.mjs")],
        entry: resolve("src/cli.ts"),
      },
      { cwd: root },
    );
    manager = await createFactoryManager(
      { runtime, agentDir: join(dir.path, "agent"), shim, beforeLaunch, ...extra },
      { cwd: root },
    );
    return { spare, worker, shim, manager };
  }
  /**
   * Waits until no worker runs and each host slot is free. A Thread can be final before the executor releases its slot,
   * so a check of only the Thread status races with the next reservation.
   */
  async function idle(target: FactoryManager) {
    await vi.waitFor(async () => {
      const snapshot = await target.snapshot();
      expect(snapshot.workers.running).toBe(0);
      expect(snapshot.hosts.every((host) => host.used === 0)).toBe(true);
    });
  }
  async function settled() {
    await vi.waitFor(
      async () => {
        const workers = (await listThreads({ role: "worker" }, { cwd: root })).threads;
        expect(workers.length).toBe(1);
        expect(["completed", "failed", "interrupted", "cancelled"]).toContain(workers[0]?.status);
      },
      { timeout: 10000, interval: 20 },
    );
    return (await listThreads({ role: "worker" }, { cwd: root })).threads[0];
  }
  it("refuses to start while an old factory.json exists, before it takes ownership", async () => {
    const paths = projectPaths(root);
    await writeFile(paths.legacyFactorySettingsFile, "{ not parsed");
    const start = createFactoryManager(
      { runtime: {} as never, agentDir: join(dir.path, "agent"), shim: {} as never },
      { cwd: root },
    );
    await expect(start).rejects.toMatchObject({
      code: "CONFLICT",
      hint: expect.stringContaining("rowbly doctor --fix"),
    });
    await expect(readFile(await runtimePath(paths, "factory.lock"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("starts a worker without a supervisor session and moves the Story through the exact CLI shim", async () => {
    const story = await createStory({ title: "Complete me", stage: "WORK" }, { cwd: root });
    const f = await fixture();
    f.worker.setResponses([
      tool("bash", {
        command: `rowbly -C "$ROWBLY_ROOT" --json story update ${story.id} --stage DONE`,
      }),
      tool("report_result", { outcome: "complete", summary: "Moved", blockers: [], problems: [] }),
      fauxAssistantMessage("Done"),
    ]);
    const run = f.manager.run();
    try {
      const worker = await settled();
      expect(worker?.status).toBe("completed");
      expect(worker?.result?.summary).toBe("Moved");
      expect((await getStory({ id: story.id }, { cwd: root })).stage).toBe("DONE");
      const threads = (await listThreads({}, { cwd: root })).threads;
      expect(threads.map((t) => t.role)).toEqual(["worker"]);
      expect(threads[0]?.parentThreadId).toBeUndefined();
      expect(reserveWorker).toHaveBeenCalledWith(expect.anything(), {
        storyId: story.id,
        stage: "WORK",
        requestId: `${story.id}:WORK:1`,
      });
      for (const t of threads) {
        expect(t.session.file).toBeTruthy();
        expect(await readFile(join(root, ".rowbly/runtime", t.session.file as string), "utf8")).toContain(
          '"role":"toolResult"',
        );
      }
      expect((await readFactoryState(root)).attempts).toHaveLength(1);
    } finally {
      await f.manager.shutdown();
      await run;
    }
  }, 15000);
  it("publishes bounded live activity and usage, then final totals", async () => {
    const story = await createStory({ title: "Progress", stage: "WORK" }, { cwd: root });
    const f = await fixture();
    f.worker.setResponses([tool("bash", { command: "sleep 1.5" }), fauxAssistantMessage("RESULT: complete")]);
    await f.manager.reserveWorker({ storyId: story.id, stage: "WORK", requestId: "activity" });
    await vi.waitFor(
      async () => {
        const t = (await listThreads({ role: "worker" }, { cwd: root })).threads[0];
        expect(t?.status).toBe("running");
        expect(t?.lastTool).toBe("bash");
        expect(t?.lastActivityAt).toBeTruthy();
        expect(t?.usage?.input).toBeTypeOf("number");
      },
      { timeout: 4000, interval: 30 },
    );
    const t = await settled();
    expect(t?.lastTool).toBe("bash");
    expect(t?.usage?.output).toBeGreaterThanOrEqual(0);
  });
  it("cancels only the expected run and suppresses automatic reassignment", async () => {
    let release = () => {};
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const story = await createStory({ title: "Cancel", stage: "WORK" }, { cwd: root });
    const f = await fixture(() => barrier);
    const { threadId } = await f.manager.reserveWorker({ storyId: story.id, stage: "WORK", requestId: "cancel" });
    const t = (await listThreads({ role: "worker" }, { cwd: root })).threads[0];
    try {
      await expect(f.manager.cancelWorker(threadId, "old-run")).rejects.toThrow(/changed/);
      await f.manager.cancelWorker(threadId, t.runs.at(-1)?.id ?? "missing");
      release();
      expect((await settled())?.status).toBe("cancelled");
      expect((await f.manager.reconcile()).find((d) => d.story === story.id)?.reason).toBe("cancelled by user");
    } finally {
      release();
    }
  });
  it("persists pending intent and rejects duplicates, capacity overflow, and stale Stages", async () => {
    let release = () => {};
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const story = await createStory({ title: "Pending", stage: "WORK" }, { cwd: root });
    const other = await createStory({ title: "Other", stage: "WORK" }, { cwd: root });
    const f = await fixture(() => barrier);
    const reservation = await f.manager.reserveWorker({ storyId: story.id, stage: "WORK", requestId: "a" });
    try {
      expect(await f.manager.reserveWorker({ storyId: story.id, stage: "WORK", requestId: "a" })).toEqual(reservation);
      expect((await f.manager.snapshot()).workers.pending).toBe(1);
      expect((await readFactoryState(root)).attempts[0]?.status).toBe("preparing");
      // The worker Thread, its attempt, the active entry and the status snapshot record the local host.
      const threadFile = join(root, ".rowbly/runtime/threads", `${reservation.threadId}.json`);
      expect(JSON.parse(await readFile(threadFile, "utf8")).host).toBe("local");
      expect((await readFactoryState(root)).attempts[0]?.host).toBe("local");
      // The worker Thread and its attempt keep the uid of the Story.
      expect(story.uid).toEqual(expect.any(String));
      expect(JSON.parse(await readFile(threadFile, "utf8")).storyUid).toBe(story.uid);
      expect((await readFactoryState(root)).attempts[0]?.storyUid).toBe(story.uid);
      const managerArg = vi.mocked(setState).mock.calls.at(-1)?.[0];
      if (!managerArg) throw new Error("Missing manager");
      expect(getState(managerArg).active.get(reservation.threadId)?.host).toBe("local");
      expect((await f.manager.snapshot()).threads).toContainEqual(
        expect.objectContaining({ id: reservation.threadId, host: "local" }),
      );
      // The status file lists queued work for the TUI, without the Stories that wait for no worker.
      const status = JSON.parse(await readFile(join(root, ".rowbly/runtime/status.json"), "utf8"));
      expect(status.queue).toContainEqual(
        expect.objectContaining({ story: other.id, reason: "worker limit", provider: "worker" }),
      );
      expect(status.queue.some((d: { reason: string }) => d.reason === "hold stage")).toBe(false);
      await expect(f.manager.reserveWorker({ storyId: story.id, stage: "WORK", requestId: "b" })).rejects.toThrow(
        "active worker",
      );
      await expect(f.manager.reserveWorker({ storyId: other.id, stage: "WORK", requestId: "c" })).rejects.toThrow(
        "capacity",
      );
      await updateStory({ id: story.id, stage: "DONE" }, { cwd: root });
      release();
      expect((await settled())?.status).toBe("failed");
      await expect(f.manager.reserveWorker({ storyId: other.id, stage: "DONE", requestId: "d" })).rejects.toThrow(
        "Stage changed",
      );
    } finally {
      release();
    }
  });
  it("places workers with injected worker hosts, and shows the slots of each host", async () => {
    let release = () => {};
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const story = await createStory({ title: "Placed", stage: "WORK" }, { cwd: root });
    const other = await createStory({ title: "Other", stage: "WORK" }, { cwd: root });
    const hosts = [
      { id: "remote-a", maxWorkers: 2, state: "connected" as const, providers: ["worker"] },
      { id: "remote-b", maxWorkers: 1, state: "disconnected" as const, providers: ["worker"] },
    ];
    const worktreeFacts = vi.fn(async () => undefined);
    const f = await fixture(() => barrier, { workerHosts: async () => hosts, worktreeFacts });
    const workers = async () => (await listThreads({ role: "worker" }, { cwd: root })).threads;
    try {
      await expect(
        f.manager.reserveWorker({ storyId: story.id, stage: "WORK", requestId: "unknown", host: "nowhere" }),
      ).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("unknown host nowhere") });
      await expect(
        f.manager.reserveWorker({ storyId: story.id, stage: "WORK", requestId: "refused", host: "remote-b" }),
      ).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("remote-b is disconnected") });
      await expect(
        f.manager.reserveWorker({ storyId: story.id, stage: "WORK", requestId: "remote", host: "remote-a" }),
      ).rejects.toMatchObject({ code: "CONFLICT", message: "Remote dispatch is not available" });
      expect(await workers()).toHaveLength(0);
      expect(worktreeFacts).toHaveBeenCalled();
      const local = await f.manager.reserveWorker({ storyId: story.id, stage: "WORK", requestId: "a", host: "local" });
      expect((await workers()).find((t) => t.id === local.threadId)?.host).toBe("local");
      // The local slot is full, so prefer-local places the other Story on the worker host.
      await expect(f.manager.reserveWorker({ storyId: other.id, stage: "WORK", requestId: "b" })).rejects.toThrow(
        "Remote dispatch is not available",
      );
      expect(await workers()).toHaveLength(1);
      // The policy limit is the sum of the slots of the connected hosts.
      expect((await f.manager.reconcile()).find((d) => d.story === other.id)?.action).toBe("start");
      expect((await f.manager.snapshot()).hosts).toEqual([
        { id: "local", state: "connected", max: 1, used: 1, free: 0 },
        { id: "remote-a", state: "connected", max: 2, used: 0, free: 2 },
        { id: "remote-b", state: "disconnected", max: 1, used: 0, free: 1 },
      ]);
      const status = JSON.parse(await readFile(join(root, ".rowbly/runtime/status.json"), "utf8"));
      expect(status.hosts).toHaveLength(3);
    } finally {
      release();
    }
    await settled();
  });
  it("retains dirty worktrees and records assistant errors as failures", async () => {
    const story = await createStory({ title: "Fail", stage: "WORK" }, { cwd: root });
    const f = await fixture();
    f.worker.setResponses([
      tool("write", { path: "dirty.txt", content: "preserve me" }),
      fauxAssistantMessage("", { stopReason: "error", errorMessage: "offline simulated failure" }),
    ]);
    await f.manager.reserveWorker({ storyId: story.id, stage: "WORK", requestId: "failure" });
    const worker = await settled();
    expect(worker?.status).toBe("failed");
    expect(await readFile(join(worker?.worktree as string, "dirty.txt"), "utf8")).toBe("preserve me");
    await vi.waitFor(async () => expect((await readFactoryState(root)).attempts[0]?.status).toBe("failed"));
    const entry = (await attentionOf(f)).get(`worker:${story.id}`) as { text: string; storyId?: string };
    expect(entry.storyId).toBe(story.id);
    expect(entry.text).toContain(`worker ${worker?.id} failed`);
    expect(entry.text).toContain("offline simulated failure");
  });
  it("resumes the exact session and v1 attempt with a new run", async () => {
    const story = await createStory({ title: "Resume", stage: "WORK" }, { cwd: root });
    const f = await fixture();
    f.worker.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "simulated" })]);
    await f.manager.reserveWorker({ storyId: story.id, stage: "WORK", requestId: "first" });
    const previous = await settled();
    await idle(f.manager);
    await f.manager.reconcile();
    f.worker.setResponses([
      tool("report_result", { outcome: "complete", summary: "Resumed", blockers: [], problems: [] }),
      fauxAssistantMessage("Done"),
    ]);
    if (!previous?.runs.at(-1)) throw new Error("Missing previous run");
    const previousRun = previous.runs.at(-1)?.id ?? "missing";
    await f.manager.resumeWorker(previous.id, previousRun, "resume");
    await f.manager.resumeWorker(previous.id, previousRun, "resume");
    await vi.waitFor(async () =>
      expect((await listThreads({ role: "worker" }, { cwd: root })).threads[0]?.status).toBe("completed"),
    );
    const current = (await listThreads({ role: "worker" }, { cwd: root })).threads[0];
    expect(current?.session).toEqual(previous?.session);
    expect(current?.runs).toHaveLength(2);
    expect((await readFactoryState(root)).attempts).toHaveLength(1);
  });
  it("idle factory makes zero provider calls across repeated board saves", async () => {
    await createStory({ title: "Waits in Backlog", stage: "BACKLOG" }, { cwd: root });
    const f = await fixture();
    const model = vi.fn();
    const unexpected = () => {
      model();
      return fauxAssistantMessage("Unexpected");
    };
    f.worker.setResponses([unexpected]);
    f.spare.setResponses([unexpected]);
    const run = f.manager.run();
    try {
      await vi.waitFor(async () => expect((await f.manager.snapshot()).phase).toBe("ready"));
      const scans = vi.mocked(scan).mock.calls.length;
      for (let i = 0; i < 10; i++) await writeFile(join(root, ".rowbly/ROWBLY.md"), `# Instructions ${i}`);
      await vi.waitFor(() => expect(vi.mocked(scan).mock.calls.length).toBeGreaterThan(scans + 2));
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(model).not.toHaveBeenCalled();
      expect(reserveWorker).not.toHaveBeenCalled();
      expect((await listThreads({}, { cwd: root })).threads).toEqual([]);
    } finally {
      await f.manager.shutdown();
      await run;
    }
  });
  it("pushes the canonical commit after start, and shows a push failure as attention", async () => {
    const remote = join(dir.path, "remote.git");
    await exec("git", ["init", "-q", "--bare", remote]);
    await exec("git", ["-C", root, "config", "user.name", "Test"]);
    await exec("git", ["-C", root, "config", "user.email", "test@example.com"]);
    await exec("git", ["-C", root, "remote", "add", "origin", remote]);
    await exec("git", ["-C", root, "push", "-q", "-u", "origin", "HEAD"]);
    const f = await fixture();
    await updateFactorySettings({ git: { push: true } }, { cwd: root });
    await writeFile(join(root, ".rowbly/ROWBLY.md"), "# Synced\n");
    const head = async (cwd: string, ref = "HEAD") => (await exec("git", ["-C", cwd, "rev-parse", ref])).stdout.trim();
    const initial = await head(root);
    const run = f.manager.run();
    try {
      await vi.waitFor(
        async () => {
          expect(await head(root)).not.toBe(initial);
          expect(await head(remote, "HEAD")).toBe(await head(root));
        },
        { timeout: 10000, interval: 50 },
      );
      expect((await f.manager.snapshot()).attention).toEqual([]);
    } finally {
      await f.manager.shutdown();
      await run;
    }

    manager = undefined;
    await exec("git", ["-C", root, "checkout", "-q", "-b", "no-upstream"]);
    const again = await fixture();
    const second = again.manager.run();
    try {
      await vi.waitFor(
        async () => {
          const attention = new Map((await again.manager.snapshot()).attention as [string, { text: string }][]);
          expect(attention.get("push")?.text).toBe("Git push failed: The current branch has no upstream branch.");
        },
        { timeout: 10000, interval: 50 },
      );
      expect((await again.manager.snapshot()).phase).toBe("ready");
    } finally {
      await again.manager.shutdown();
      await second;
    }
  }, 30000);
  it("commits canonical files with the configured message and author", async () => {
    const f = await fixture();
    await updateFactorySettings(
      { git: { commitMessage: "chore: board sync", authorName: "Rowbly Bot", authorEmail: "bot@example.com" } },
      { cwd: root },
    );
    await writeFile(join(root, ".rowbly/ROWBLY.md"), "# Changed");
    const run = f.manager.run();
    try {
      await vi.waitFor(
        async () => {
          const log = await exec("git", ["-C", root, "log", "-1", "--format=%s|%an <%ae>|%cn <%ce>"]);
          expect(log.stdout.trim()).toBe("chore: board sync|Rowbly Bot <bot@example.com>|Rowbly Bot <bot@example.com>");
        },
        { timeout: 10000, interval: 50 },
      );
    } finally {
      await f.manager.shutdown();
      await run;
    }
  });
  it("starts a worker for a new middle Stage on the first scan, with no classification", async () => {
    const story = await createStory({ title: "No classification", stage: "WORK" }, { cwd: root });
    const f = await fixture();
    expect((await f.manager.snapshot()).decisions).toContainEqual(
      expect.objectContaining({ story: story.id, stage: "WORK", action: "start" }),
    );
    expect(await readFactoryState(root)).not.toHaveProperty("prompts");
    f.worker.setResponses([
      tool("report_result", { outcome: "complete", summary: "Done", blockers: [], problems: [] }),
      fauxAssistantMessage("Done"),
    ]);
    const run = f.manager.run();
    try {
      expect((await settled())?.status).toBe("completed");
      expect(await readFactoryState(root)).not.toHaveProperty("prompts");
    } finally {
      await f.manager.shutdown();
      await run;
    }
  });
  it("keeps the prompts key of an old state file and does not use it", async () => {
    const story = await createStory({ title: "Old state", stage: "WORK" }, { cwd: root });
    const prompts = { WORK: { hash: "old", class: "hold" }, BACKLOG: { hash: "old", class: "work" } };
    await updateFactoryState(root, (state) => ({ ...state, prompts }));
    const f = await fixture();
    expect((await f.manager.snapshot()).decisions).toContainEqual(
      expect.objectContaining({ story: story.id, action: "start" }),
    );
    expect((await readFactoryState(root)).prompts).toEqual(prompts);
  });
  it("gives no workers to a Stage with hold in factory.stageClasses", async () => {
    const story = await createStory({ title: "Held by class", stage: "WORK" }, { cwd: root });
    await updateFactorySettings({ stageClasses: { WORK: "hold" } }, { cwd: root });
    const f = await fixture();
    expect((await f.manager.snapshot()).decisions).toContainEqual(
      expect.objectContaining({ story: story.id, action: "skip", reason: "hold stage" }),
    );
    await expect(f.manager.reserveWorker({ storyId: story.id, stage: "WORK", requestId: "held" })).rejects.toThrow(
      "not eligible",
    );
    expect((await listThreads({ role: "worker" }, { cwd: root })).threads).toEqual([]);
  });
  it("makes the first and the last Stage work when factory.stageClasses says work", async () => {
    const first = await createStory({ title: "First", stage: "BACKLOG" }, { cwd: root });
    const last = await createStory({ title: "Last", stage: "DONE" }, { cwd: root });
    await updateFactorySettings({ stageClasses: { BACKLOG: "work", DONE: "work" } }, { cwd: root });
    const f = await fixture();
    const { decisions } = await f.manager.snapshot();
    // The limit is one worker, so one Story waits for the limit, not for its Stage.
    expect(decisions.map((d) => d.story).toSorted()).toEqual([first.id, last.id]);
    expect(decisions.map((d) => d.reason).toSorted()).toEqual(["new stage stay", "worker limit"]);
  });
  it("holds the first and the last Stage of the config order also with other keys", async () => {
    await createStage({ label: "Ideas", key: "IDEAS", prompt: "Ideas.", position: 1 }, { cwd: root });
    await createStage({ label: "Shipped", key: "SHIPPED", prompt: "Shipped." }, { cwd: root });
    const first = await createStory({ title: "Idea", stage: "IDEAS" }, { cwd: root });
    const last = await createStory({ title: "Shipped", stage: "SHIPPED" }, { cwd: root });
    const backlog = await createStory({ title: "Backlog", stage: "BACKLOG" }, { cwd: root });
    const f = await fixture();
    const { decisions } = await f.manager.snapshot();
    expect(decisions).toContainEqual(
      expect.objectContaining({ story: first.id, action: "skip", reason: "hold stage" }),
    );
    expect(decisions).toContainEqual(expect.objectContaining({ story: last.id, action: "skip", reason: "hold stage" }));
    expect(decisions).toContainEqual(expect.objectContaining({ story: backlog.id, action: "start" }));
  });
  it("gives invalid to an empty prompt, unless factory.stageClasses has the Stage", async () => {
    await createStage({ label: "Empty", key: "EMPTY", prompt: " ", position: 2 }, { cwd: root });
    await createStage({ label: "Blank", key: "BLANK", prompt: "", position: 2 }, { cwd: root });
    const empty = await createStory({ title: "Empty", stage: "EMPTY" }, { cwd: root });
    const blank = await createStory({ title: "Blank", stage: "BLANK" }, { cwd: root });
    await updateFactorySettings({ stageClasses: { BLANK: "work" } }, { cwd: root });
    const f = await fixture();
    const { decisions } = await f.manager.snapshot();
    expect(decisions).toContainEqual(
      expect.objectContaining({ story: empty.id, action: "skip", reason: "stage prompt missing or invalid" }),
    );
    expect(decisions).toContainEqual(expect.objectContaining({ story: blank.id, action: "start" }));
  });
  it("refuses to reserve a worker for a blocked Story", async () => {
    const upstream = await createStory({ title: "Upstream", stage: "BACKLOG" }, { cwd: root });
    const blocked = await createStory({ title: "Blocked", stage: "WORK", dependsOn: [upstream.id] }, { cwd: root });
    const f = await fixture();
    await expect(f.manager.reserveWorker({ storyId: blocked.id, stage: "WORK", requestId: "blocked" })).rejects.toThrow(
      `Story is not eligible: waiting for ${upstream.id}`,
    );
    expect((await f.manager.snapshot()).workers.pending).toBe(0);
    expect((await readFactoryState(root)).attempts).toEqual([]);
    expect((await listThreads({ role: "worker" }, { cwd: root })).threads).toEqual([]);
  });
  async function dependencyFixture(upstreamStage: string) {
    const prompt = "Build this Story. Report complete.";
    await createStage({ label: "Build", key: "BUILD", prompt, position: 2 }, { cwd: root });
    const upstream = await createStory({ title: "Upstream", stage: upstreamStage }, { cwd: root });
    const downstream = await createStory(
      { title: "Downstream", stage: "BUILD", dependsOn: [upstream.id] },
      { cwd: root },
    );
    const f = await fixture();
    return { f, upstream, downstream };
  }
  it("gives the dependency lists in the factory snapshot", async () => {
    const { f, upstream, downstream } = await dependencyFixture("BUILD");
    const decisions = (await f.manager.snapshot()).decisions as unknown as Record<string, unknown>[];
    expect(decisions.find((d) => d.story === downstream.id)).toMatchObject({
      dependsOn: [upstream.id],
      blocks: [],
      waitingFor: [upstream.id],
    });
    expect(decisions.find((d) => d.story === upstream.id)).toMatchObject({
      dependsOn: [],
      blocks: [downstream.id],
      waitingFor: [],
    });
  });
  it("raises attention for a stuck upstream Story, without a start, and removes it when the Story can progress", async () => {
    const { f, upstream, downstream } = await dependencyFixture("BACKLOG");
    const key = `upstream-stuck:${upstream.id}`;
    f.worker.setResponses([
      tool("report_result", { outcome: "complete", summary: "Upstream", blockers: [], problems: [] }),
      fauxAssistantMessage("Done"),
    ]);
    const workers = async () => (await listThreads({ role: "worker" }, { cwd: root })).threads;
    const upstreamKeys = async () =>
      [...(await attentionOf(f)).keys()].filter((entry) => entry.startsWith("upstream-stuck:"));
    const run = f.manager.run();
    try {
      await vi.waitFor(async () => expect(await upstreamKeys()).toEqual([key]), { timeout: 10000, interval: 20 });
      const entry = (await attentionOf(f)).get(key) as { text: string; storyId?: string };
      expect(entry.storyId).toBe(upstream.id);
      expect(entry.text).toContain(downstream.id);
      const scans = vi.mocked(scan).mock.calls.length;
      await updateStory({ id: downstream.id, title: "Downstream again" }, { cwd: root });
      await vi.waitFor(() => expect(vi.mocked(scan).mock.calls.length).toBeGreaterThan(scans + 2), {
        timeout: 10000,
        interval: 20,
      });
      expect(await upstreamKeys()).toEqual([key]);
      expect(await workers()).toEqual([]);
      await updateStory({ id: upstream.id, stage: "BUILD" }, { cwd: root });
      await vi.waitFor(async () => expect(await upstreamKeys()).toEqual([]), { timeout: 10000, interval: 20 });
      await vi.waitFor(async () => expect((await workers()).map((t) => t.storyId)).toContain(upstream.id), {
        timeout: 10000,
        interval: 20,
      });
      expect((await workers()).map((t) => t.storyId)).not.toContain(downstream.id);
    } finally {
      await f.manager.shutdown();
      await run;
    }
  });
  async function pullFixture(upstreamStage: string, pull: boolean) {
    await updateFactorySettings(
      { dependencies: { pullUpstream: pull }, git: { authorName: "Factory", authorEmail: "factory@example.com" } },
      { cwd: root },
    );
    return dependencyFixture(upstreamStage);
  }
  async function runUntil(f: { manager: FactoryManager }, check: () => Promise<void>) {
    const run = f.manager.run();
    try {
      await vi.waitFor(check, { timeout: 10000, interval: 20 });
    } finally {
      await f.manager.shutdown();
      await run;
    }
  }
  const upstreamKeysOf = async (f: { manager: FactoryManager }) =>
    [...(await attentionOf(f)).keys()].filter((entry) => entry.startsWith("upstream-stuck:"));
  const subjects = async () => (await exec("git", ["-C", root, "log", "--format=%s"])).stdout;
  it("keeps the upstream Story in Backlog while pull-upstream is off", async () => {
    const { f, upstream } = await pullFixture("BACKLOG", false);
    const scans = vi.mocked(scan).mock.calls.length;
    await runUntil(f, async () => {
      expect(await upstreamKeysOf(f)).toEqual([`upstream-stuck:${upstream.id}`]);
      expect(vi.mocked(scan).mock.calls.length).toBeGreaterThan(scans + 1);
    });
    expect((await getStory({ id: upstream.id }, { cwd: root })).stage).toBe("BACKLOG");
    expect(await subjects()).not.toContain("out of Backlog");
  });
  it("moves a stuck upstream Story to the first work Stage, commits the move and starts it", async () => {
    const { f, upstream, downstream } = await pullFixture("BACKLOG", true);
    f.worker.setResponses([
      tool("report_result", { outcome: "complete", summary: "Upstream", blockers: [], problems: [] }),
      fauxAssistantMessage("Done"),
    ]);
    stateLockHeld.nested = 0;
    await runUntil(f, async () => {
      expect((await getStory({ id: upstream.id }, { cwd: root })).stage).toBe("BUILD");
      expect(await upstreamKeysOf(f)).toEqual([]);
      const workers = (await listThreads({ role: "worker" }, { cwd: root })).threads;
      expect(workers[0]).toMatchObject({ storyId: upstream.id, stage: "BUILD" });
    });
    expect(await subjects()).toContain(`chore(rowbly): move ${upstream.id} out of Backlog for ${downstream.id}`);
    expect(stateLockHeld.nested).toBe(0);
  });
  it("moves the indirect upstream Stories in one pass", async () => {
    const indirect = await createStory({ title: "Indirect", stage: "BACKLOG" }, { cwd: root });
    const { f, upstream, downstream } = await pullFixture("BACKLOG", true);
    // A later time puts the upstream Story first in the board order, and so first in the commit message.
    await updateStory(
      { id: upstream.id, dependsOn: [indirect.id] },
      { cwd: root, now: () => new Date(Date.now() + 60_000) },
    );
    await runUntil(f, async () => {
      expect((await getStory({ id: upstream.id }, { cwd: root })).stage).toBe("BUILD");
      expect((await getStory({ id: indirect.id }, { cwd: root })).stage).toBe("BUILD");
    });
    expect(await subjects()).toContain(
      `chore(rowbly): move ${upstream.id}, ${indirect.id} out of Backlog for ${downstream.id}`,
    );
  });
  it("does not move a parked upstream Story or an upstream Story in a hold Stage", async () => {
    const prompt = "Wait for a person.";
    await createStage({ label: "Wait", key: "WAIT", prompt, position: 3 }, { cwd: root });
    const held = await createStory({ title: "Held", stage: "WAIT" }, { cwd: root });
    await updateFactorySettings({ stageClasses: { WAIT: "hold" } }, { cwd: root });
    const { f, upstream, downstream } = await pullFixture("BACKLOG", true);
    await updateStory({ id: downstream.id, dependsOn: [upstream.id, held.id] }, { cwd: root });
    await updateFactoryState(root, (state) => ({
      ...state,
      parked: {
        [upstream.id]: { stage: "BACKLOG", hash: storyHash(upstream), reason: "test", since: "", reported: true },
      },
    }));
    const scans = vi.mocked(scan).mock.calls.length;
    await runUntil(f, async () => {
      expect((await upstreamKeysOf(f)).toSorted()).toEqual(
        [`upstream-stuck:${upstream.id}`, `upstream-stuck:${held.id}`].toSorted(),
      );
      expect(vi.mocked(scan).mock.calls.length).toBeGreaterThan(scans + 1);
    });
    expect((await getStory({ id: upstream.id }, { cwd: root })).stage).toBe("BACKLOG");
    expect((await getStory({ id: held.id }, { cwd: root })).stage).toBe("WAIT");
  });
  it("does not move for a blocked downstream Story in Backlog", async () => {
    const { f, upstream, downstream } = await pullFixture("BACKLOG", true);
    await updateStory({ id: downstream.id, stage: "BACKLOG" }, { cwd: root });
    const scans = vi.mocked(scan).mock.calls.length;
    await runUntil(f, async () => {
      expect(vi.mocked(scan).mock.calls.length).toBeGreaterThan(scans + 1);
      expect(await upstreamKeysOf(f)).toEqual([]);
    });
    expect((await getStory({ id: upstream.id }, { cwd: root })).stage).toBe("BACKLOG");
  });
  it("rejects a changed prompt after durable reservation", async () => {
    let release = () => {};
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const story = await createStory({ title: "Changed prompt", stage: "WORK" }, { cwd: root });
    const f = await fixture(() => barrier);
    await f.manager.reserveWorker({ storyId: story.id, stage: "WORK", requestId: "before-change" });
    await writeFile(join(root, ".rowbly/stages/WORK.md"), "Different instructions");
    release();
    expect((await settled())?.error?.message).toContain("prompt changed");
  });
  it("uses Story and Stage worker model overrides before the requested model", async () => {
    const staged = await createStory({ title: "Stage override", stage: "WORK" }, { cwd: root });
    const pinned = await createStory({ title: "Story override", stage: "WORK" }, { cwd: root });
    await updateFactorySettings(
      {
        stageWorkerModels: { WORK: { provider: "spare", modelId: "faux-1" } },
        storyWorkerModels: { [pinned.id]: { WORK: { provider: "worker", modelId: "faux-1" } } },
      },
      { cwd: root },
    );
    const f = await fixture();
    expect(f.spare.getModel().id).toBe("faux-1");
    f.spare.setResponses([fauxAssistantMessage("RESULT: complete")]);
    await f.manager.reserveWorker({
      storyId: staged.id,
      stage: "WORK",
      requestId: "stage-override",
      model: { provider: f.worker.getModel().provider, modelId: f.worker.getModel().id },
    });
    expect((await settled())?.model).toEqual({ provider: "spare", modelId: "faux-1" });
    f.worker.setResponses([fauxAssistantMessage("RESULT: complete")]);
    // The slot of the first worker is free only after its launch task ends.
    await vi.waitFor(
      () => f.manager.reserveWorker({ storyId: pinned.id, stage: "WORK", requestId: "story-override" }),
      {
        timeout: 5000,
        interval: 30,
      },
    );
    await vi.waitFor(async () => {
      const thread = (await listThreads({ story: pinned.id }, { cwd: root })).threads[0];
      expect(thread?.model).toEqual({ provider: "worker", modelId: "faux-1" });
      expect(["completed", "failed"]).toContain(thread?.status);
    });
  });
  it("quota pause does not block a worker with another provider", async () => {
    const story = await createStory({ title: "Quota", stage: "WORK" }, { cwd: root });
    const other = await createStory({ title: "Other provider", stage: "WORK" }, { cwd: root });
    const f = await fixture();
    f.worker.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "429 usage limit" })]);
    await f.manager.reserveWorker({ storyId: story.id, stage: "WORK", requestId: "quota" });
    await settled();
    await idle(f.manager);
    expect((await f.manager.snapshot()).providers.worker?.reason).toBe("quota");
    await expect(f.manager.reserveWorker({ storyId: other.id, stage: "WORK", requestId: "paused" })).rejects.toThrow(
      "paused",
    );
    f.spare.setResponses([
      tool("report_result", { outcome: "complete", summary: "Other provider", blockers: [], problems: [] }),
      fauxAssistantMessage("Done"),
    ]);
    await f.manager.reserveWorker({
      storyId: other.id,
      stage: "WORK",
      requestId: "other",
      model: { provider: f.spare.getModel().provider, modelId: f.spare.getModel().id },
    });
    await vi.waitFor(async () =>
      expect((await listThreads({ story: other.id }, { cwd: root })).threads[0]?.status).toBe("completed"),
    );
    await f.manager.retryProvider("worker");
    expect((await f.manager.snapshot()).providers.worker).toBeUndefined();
  });
  it("starts a new worker with the first fallback model when the worker provider is paused", async () => {
    const story = await createStory({ title: "Quota", stage: "WORK" }, { cwd: root });
    const other = await createStory({ title: "Fallback", stage: "WORK" }, { cwd: root });
    const fallback = { provider: "spare", modelId: "faux-1" };
    await updateFactorySettings({ fallbackWorkerModels: [fallback] }, { cwd: root });
    const f = await fixture();
    f.worker.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "429 usage limit" })]);
    await f.manager.reserveWorker({ storyId: story.id, stage: "WORK", requestId: "quota" });
    const previous = await settled();
    await idle(f.manager);
    expect((await f.manager.snapshot()).providers.worker?.reason).toBe("quota");
    expect(previous?.model).toEqual({ provider: "worker", modelId: "faux-1" });

    // A resumed Thread keeps its model, so the pause of its provider stops it, also with a fallback model.
    const lastRun = previous?.runs.at(-1)?.id ?? "missing";
    await expect(f.manager.resumeWorker(previous?.id ?? "missing", lastRun, "resume")).rejects.toThrow("paused");
    expect((await listThreads({ story: story.id }, { cwd: root })).threads[0]?.model).toEqual(previous?.model);

    // The fallback model has a provider that is not paused, so the Story is not skipped.
    const decision = (await f.manager.snapshot()).decisions.find((d) => d.story === other.id);
    expect(decision?.action).toBe("start");
    f.spare.setResponses([
      tool("report_result", { outcome: "complete", summary: "Fallback", blockers: [], problems: [] }),
      fauxAssistantMessage("Done"),
    ]);
    await f.manager.reserveWorker({ storyId: other.id, stage: "WORK", requestId: "fallback" });
    await vi.waitFor(async () => {
      const thread = (await listThreads({ story: other.id }, { cwd: root })).threads[0];
      expect(thread?.status).toBe("completed");
      expect(thread?.model).toEqual(fallback);
    });
    const status = JSON.parse(await readFile(await runtimePath(projectPaths(root), "status.json"), "utf8"));
    expect(status.queue.find((entry: { story: string }) => entry.story === story.id)?.provider).toBe("spare");
  });
  it("skips a Story with the reason provider paused when each worker model has a paused provider", async () => {
    const story = await createStory({ title: "Quota", stage: "WORK" }, { cwd: root });
    const other = await createStory({ title: "No model", stage: "WORK" }, { cwd: root });
    await updateFactorySettings({ fallbackWorkerModels: [{ provider: "worker", modelId: "faux-1" }] }, { cwd: root });
    const f = await fixture();
    f.worker.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "429 usage limit" })]);
    await f.manager.reserveWorker({ storyId: story.id, stage: "WORK", requestId: "quota" });
    await settled();
    await idle(f.manager);
    await expect(f.manager.reserveWorker({ storyId: other.id, stage: "WORK", requestId: "paused" })).rejects.toThrow(
      "Worker provider is paused",
    );
    expect((await listThreads({ story: other.id }, { cwd: root })).threads).toHaveLength(0);
    const decision = (await f.manager.snapshot()).decisions.find((d) => d.story === other.id);
    expect(decision).toMatchObject({ action: "skip", reason: "provider paused" });
    expect((await f.manager.reconcile()).find((d) => d.story === other.id)?.reason).toBe("provider paused");
  });
  it("pauses the provider for a connectivity error, then resumes the same Thread when the pause ends", async () => {
    const story = await createStory({ title: "Offline", stage: "WORK" }, { cwd: root });
    const other = await createStory({ title: "Other", stage: "WORK" }, { cwd: root });
    const f = await fixture();
    f.worker.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "fetch failed" })]);
    await f.manager.reserveWorker({ storyId: story.id, stage: "WORK", requestId: "offline" });
    const previous = await settled();
    await idle(f.manager);
    expect(previous?.status).toBe("failed");
    expect(previous?.resumable).toBe(true);
    expect(previous?.error).toMatchObject({ class: "transient", code: "NETWORK", message: "fetch failed" });
    const snapshot = await f.manager.snapshot();
    expect(snapshot.providers.worker).toMatchObject({ reason: "network", failures: 1 });
    expect(Date.parse(snapshot.providers.worker?.retryAt ?? "") - Date.now()).toBeGreaterThan(50_000);
    expect(Date.parse(snapshot.providers.worker?.retryAt ?? "") - Date.now()).toBeLessThanOrEqual(60_000);
    expect(previous?.error?.retryAt).toBe(snapshot.providers.worker?.retryAt);
    // The only worker provider is paused.
    expect(snapshot.connectivity).toBe("offline");
    expect(snapshot.attention).toEqual([]);

    // The pause stops each new worker on the provider, and the policy waits for the resume of the Thread.
    await f.manager.reconcile();
    await expect(f.manager.reserveWorker({ storyId: other.id, stage: "WORK", requestId: "paused" })).rejects.toThrow(
      "paused",
    );
    const decisions = (await f.manager.snapshot()).decisions;
    expect(decisions.find((d) => d.story === story.id)?.reason).toBe("waiting for network resume");
    const state = await readFactoryState(root);
    expect(state.parked?.[story.id]).toBeUndefined();
    expect(state.attempts.find((a) => a.story === story.id)?.status).toBe("failed");

    // A deadline after the pause: the next pass clears the pause and resumes the same Thread without a person.
    // The resumed Thread takes the only slot. Then the manager starts a worker for the other Story.
    f.worker.setResponses([
      tool("report_result", { outcome: "complete", summary: "Resumed", blockers: [], problems: [] }),
      fauxAssistantMessage("Done"),
      tool("report_result", { outcome: "complete", summary: "Other", blockers: [], problems: [] }),
      fauxAssistantMessage("Done"),
    ]);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 2 * 60_000 });
    const run = f.manager.run();
    try {
      await vi.waitFor(
        async () => {
          const thread = (await listThreads({ story: story.id }, { cwd: root })).threads[0];
          expect(thread?.status).toBe("completed");
        },
        { timeout: 10000, interval: 20 },
      );
      const threads = (await listThreads({ story: story.id }, { cwd: root })).threads;
      expect(threads).toHaveLength(1);
      expect(threads[0]?.session).toEqual(previous?.session);
      expect(threads[0]?.runs).toHaveLength(2);
      await vi.waitFor(async () => expect((await f.manager.snapshot()).providers.worker).toBeUndefined());
      expect((await f.manager.snapshot()).connectivity).toBe("online");
      expect((await f.manager.snapshot()).networkFailures).toEqual({});
    } finally {
      await f.manager.shutdown();
      await run;
      vi.useRealTimers();
    }
  });
  it("dismisses an attention entry, and the entry does not come back after a restart", async () => {
    const paths = projectPaths(root);
    await prepareRuntime(paths);
    const statusFile = await runtimePath(paths, "status.json");
    await writeFile(
      statusFile,
      JSON.stringify({
        version: 1,
        phase: "stopped",
        attention: [
          ["commit", { text: "Canonical commit: failed" }],
          ["check", { text: "Check is pending", storyId: "TST-1" }],
        ],
      }),
    );
    const keys = (attention: unknown) => (attention as [string, unknown][]).map((entry) => entry[0]);
    const f = await fixture();
    expect(keys((await f.manager.snapshot()).attention)).toEqual(["commit", "check"]);

    await f.manager.dismissAttention("commit");
    await f.manager.dismissAttention("missing");

    expect(keys((await f.manager.snapshot()).attention)).toEqual(["check"]);
    expect(keys(JSON.parse(await readFile(statusFile, "utf8")).attention)).toEqual(["check"]);

    await f.manager.shutdown();
    manager = undefined;
    const again = await fixture();
    expect(keys((await again.manager.snapshot()).attention)).toEqual(["check"]);
  });
  async function workerEnded(storyId: string) {
    await vi.waitFor(
      async () => {
        const thread = (await listThreads({ story: storyId }, { cwd: root })).threads[0];
        expect(["completed", "failed"]).toContain(thread?.status);
      },
      { timeout: 10000, interval: 20 },
    );
    await vi.waitFor(async () => expect((await manager?.snapshot())?.hosts.every((h) => h.used === 0)).toBe(true));
    return (await listThreads({ story: storyId }, { cwd: root })).threads[0];
  }
  async function reportRun(
    f: Awaited<ReturnType<typeof fixture>>,
    storyId: string,
    report: { blockers: string[]; problems: string[] },
  ) {
    f.worker.setResponses([
      tool("report_result", { outcome: "blocked", summary: "Report", ...report }),
      fauxAssistantMessage("Done"),
    ]);
    await f.manager.reserveWorker({ storyId, stage: "WORK", requestId: `report-${storyId}` });
    return workerEnded(storyId);
  }
  async function seedAttention(entries: [string, { text: string; storyId?: string }][]) {
    const paths = projectPaths(root);
    await prepareRuntime(paths);
    await writeFile(
      await runtimePath(paths, "status.json"),
      JSON.stringify({ version: 1, phase: "stopped", attention: entries }),
    );
  }
  it("raises worker attention for a reported blocker, with the Story, the Stage, the Thread and the blocker", async () => {
    const story = await createStory({ title: "Blocked", stage: "WORK" }, { cwd: root });
    const f = await fixture();
    const thread = await reportRun(f, story.id, { blockers: ["Needs an API key"], problems: [] });
    const entry = (await attentionOf(f)).get(`worker:${story.id}`) as { text: string; storyId?: string };
    expect(entry.storyId).toBe(story.id);
    expect(entry.text).toContain(story.id);
    expect(entry.text).toContain("WORK");
    expect(entry.text).toContain(thread?.id);
    expect(entry.text).toContain("Needs an API key");
  });
  it("raises worker attention for a reported problem without blockers", async () => {
    const story = await createStory({ title: "Problem", stage: "WORK" }, { cwd: root });
    const f = await fixture();
    await reportRun(f, story.id, { blockers: [], problems: ["CI suite is flaky"] });
    const entry = (await attentionOf(f)).get(`worker:${story.id}`);
    expect(entry?.text).toContain("CI suite is flaky");
    expect(entry?.text).not.toContain("Story remains in the assigned Stage");
  });
  it("removes the worker attention entry after a result without blockers and problems", async () => {
    const story = await createStory({ title: "Clean", stage: "WORK" }, { cwd: root });
    await seedAttention([
      [`worker:${story.id}`, { text: "Old problem", storyId: story.id }],
      ["check", { text: "Check is pending" }],
    ]);
    const f = await fixture();
    expect((await attentionOf(f)).has(`worker:${story.id}`)).toBe(true);
    const thread = await reportRun(f, story.id, { blockers: [], problems: [] });
    // The manager adds a problem because the Story did not move. It is not a reported problem.
    expect(thread?.result?.problems).toEqual(["Story remains in the assigned Stage"]);
    expect([...(await attentionOf(f)).keys()]).toEqual(["check"]);
  });
  it("removes the worker attention entry when the Story leaves the Stage or is deleted", async () => {
    const moved = await createStory({ title: "Moved", stage: "WORK" }, { cwd: root });
    const deleted = await createStory({ title: "Deleted", stage: "WORK" }, { cwd: root });
    const kept = await createStory({ title: "Kept", stage: "WORK" }, { cwd: root });
    const f = await fixture();
    for (const story of [moved, deleted, kept]) await reportRun(f, story.id, { blockers: ["Blocked"], problems: [] });
    const workerKeys = async () => [...(await attentionOf(f)).keys()].filter((key) => key.startsWith("worker:"));
    expect(await workerKeys()).toEqual([`worker:${moved.id}`, `worker:${deleted.id}`, `worker:${kept.id}`]);
    // A hold Stage gets no worker, so that no retry of the manager changes the worker entries.
    await updateFactorySettings({ stageClasses: { WORK: "hold" } }, { cwd: root });
    await updateStory({ id: moved.id, stage: "DONE" }, { cwd: root });
    const run = f.manager.run();
    try {
      await vi.waitFor(async () => expect(await workerKeys()).toEqual([`worker:${deleted.id}`, `worker:${kept.id}`]), {
        timeout: 10000,
        interval: 20,
      });
      await deleteStory({ id: deleted.id }, { cwd: root });
      await vi.waitFor(async () => expect(await workerKeys()).toEqual([`worker:${kept.id}`]), {
        timeout: 10000,
        interval: 20,
      });
    } finally {
      await f.manager.shutdown();
      await run;
    }
  });
  async function attentionOf(f: { manager: FactoryManager }) {
    return new Map((await f.manager.snapshot()).attention as [string, { text: string }][]);
  }
  const completeWorker = () => [
    tool("report_result", { outcome: "complete", summary: "Done", blockers: [], problems: [] }),
    fauxAssistantMessage("Done"),
  ];
  async function workerStarted(storyId: string) {
    await vi.waitFor(
      async () =>
        expect((await listThreads({ story: storyId, role: "worker" }, { cwd: root })).threads).toHaveLength(1),
      { timeout: 10000, interval: 20 },
    );
  }
  it("starts a worker for the candidate Story while the commit step throws on each pass", async () => {
    const story = await createStory({ title: "Candidate", stage: "WORK" }, { cwd: root });
    const long = `Project write lock is unavailable ${"x".repeat(1000)}`;
    vi.mocked(commitCanonicalProject).mockRejectedValue(new Error(long));
    const f = await fixture();
    f.worker.setResponses(completeWorker());
    const run = f.manager.run();
    try {
      await workerStarted(story.id);
      const commit = (await attentionOf(f)).get("commit");
      expect(commit?.text).toContain("Canonical commit failed: Project write lock is unavailable");
      expect(commit?.text.length).toBeLessThanOrEqual(500);
      expect(commitCanonicalProject).toHaveBeenCalled();
    } finally {
      await f.manager.shutdown();
      await run;
    }
  });
  it.each([
    ["sync", "Git sync start failed", () => vi.mocked(startProjectSync).mockImplementation(() => fail())],
    ["providers", "Provider pause check failed", () => vi.mocked(readAuthStamp).mockImplementation(async () => fail())],
    [
      "settings",
      "Factory settings refresh failed",
      () => vi.mocked(getFactorySettings).mockImplementation(async () => fail()),
    ],
  ])("starts the worker when the %s step throws, and records the error", async (key, label, breakStep) => {
    const story = await createStory({ title: "Step failure", stage: "WORK" }, { cwd: root });
    const f = await fixture();
    f.worker.setResponses(completeWorker());
    breakStep();
    const run = f.manager.run();
    try {
      await workerStarted(story.id);
      const text = (await attentionOf(f)).get(key)?.text ?? "";
      expect(text).toBe(`${label}: ${"y".repeat(500)}`.slice(0, 500));
    } finally {
      await f.manager.shutdown();
      await run;
    }
  });
  it("records the scan error, then removes the reconcile entry after a pass that succeeds", async () => {
    const story = await createStory({ title: "Scan", stage: "WORK" }, { cwd: root });
    vi.mocked(scan).mockRejectedValueOnce(new Error(`Scan exploded ${"z".repeat(1000)}`));
    const f = await fixture();
    f.worker.setResponses(completeWorker());
    const statusFile = await runtimePath(projectPaths(root), "status.json");
    const statusKeys = async () =>
      (JSON.parse(await readFile(statusFile, "utf8")).attention as [string, unknown][]).map((entry) => entry[0]);
    const run = f.manager.run();
    try {
      await vi.waitFor(
        async () => {
          const text = (await attentionOf(f)).get("reconcile")?.text ?? "";
          expect(text).toContain("Project reconciliation failed; retry on the next scan: Scan exploded");
          expect(text.length).toBeLessThanOrEqual(500);
        },
        { timeout: 10000, interval: 20 },
      );
      await updateStory({ id: story.id, title: "Scan again" }, { cwd: root });
      await vi.waitFor(
        async () => {
          expect((await attentionOf(f)).has("reconcile")).toBe(false);
          expect(await statusKeys()).not.toContain("reconcile");
        },
        { timeout: 10000, interval: 20 },
      );
    } finally {
      await f.manager.shutdown();
      await run;
    }
  });
  function gate() {
    let release = () => {};
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { wait: () => wait, release: () => release() };
  }
  const workersOf = async (storyId: string) =>
    (await listThreads({ story: storyId, role: "worker" }, { cwd: root })).threads;
  const requestIds = () => vi.mocked(reserveWorker).mock.calls.map((call) => call[1].requestId);
  it("starts one worker for each start decision, also after more passes", async () => {
    const launch = gate();
    const first = await createStory({ title: "First", stage: "WORK" }, { cwd: root });
    const second = await createStory({ title: "Second", stage: "WORK" }, { cwd: root });
    const quiet = await createStory({ title: "Quiet", stage: "BACKLOG" }, { cwd: root });
    const f = await fixture(launch.wait, { maxWorkers: 2 });
    const run = f.manager.run();
    try {
      await workerStarted(first.id);
      await workerStarted(second.id);
      for (const title of ["Quiet again", "Quiet once more"]) {
        const scans = vi.mocked(scan).mock.calls.length;
        await updateStory({ id: quiet.id, title }, { cwd: root });
        await vi.waitFor(() => expect(vi.mocked(scan).mock.calls.length).toBeGreaterThan(scans + 1), {
          timeout: 10000,
          interval: 20,
        });
      }
      expect(await workersOf(first.id)).toHaveLength(1);
      expect(await workersOf(second.id)).toHaveLength(1);
      expect((await listThreads({}, { cwd: root })).threads).toHaveLength(2);
      expect(requestIds().toSorted()).toEqual([`${first.id}:WORK:1`, `${second.id}:WORK:1`].toSorted());
      // A second request for the same work gives the Thread of the first request.
      const [thread] = await workersOf(first.id);
      expect(
        await f.manager.reserveWorker({ storyId: first.id, stage: "WORK", requestId: `${first.id}:WORK:1` }),
      ).toEqual({ threadId: thread?.id });
    } finally {
      launch.release();
      await f.manager.shutdown();
      await run;
    }
  });
  it.each([
    ["a ConflictError skips only its Story, with no attention entry", new ConflictError("Host is full"), false],
    ["a different error sets the attention entry dispatch, and the pass continues", new Error("Disk exploded"), true],
  ])("starts the other Stories: %s", async (_name, error, attention) => {
    const launch = gate();
    const first = await createStory({ title: "First", stage: "WORK" }, { cwd: root });
    const second = await createStory({ title: "Second", stage: "WORK" }, { cwd: root });
    const f = await fixture(launch.wait, { maxWorkers: 2 });
    const original = vi.mocked(reserveWorker).getMockImplementation();
    if (!original) throw new Error("Missing reserveWorker");
    vi.mocked(reserveWorker).mockImplementation((target, input) =>
      input.storyId === first.id ? Promise.reject(error) : original(target, input),
    );
    const run = f.manager.run();
    try {
      await workerStarted(second.id);
      await vi.waitFor(() => expect(requestIds()).toContain(`${first.id}:WORK:1`));
      expect(await workersOf(first.id)).toEqual([]);
      await vi.waitFor(async () => expect((await attentionOf(f)).has("dispatch")).toBe(attention));
      if (attention) {
        expect((await attentionOf(f)).get("dispatch")?.text).toBe(
          `Worker dispatch failed for ${first.id}: Disk exploded`,
        );
        // A pass with no dispatch error removes the entry.
        vi.mocked(reserveWorker).mockImplementation(original);
        await updateStory({ id: first.id, title: "First again" }, { cwd: root });
        await workerStarted(first.id);
        await vi.waitFor(async () => expect((await attentionOf(f)).has("dispatch")).toBe(false));
      }
    } finally {
      launch.release();
      await f.manager.shutdown();
      await run;
    }
  });
  it("starts a new worker Thread for a retry decision, not a resume run", async () => {
    const story = await createStory({ title: "Retry", stage: "WORK" }, { cwd: root });
    const f = await fixture();
    f.worker.setResponses([
      tool("report_result", { outcome: "complete", summary: "Did not move", blockers: [], problems: [] }),
      fauxAssistantMessage("Done"),
      tool("bash", { command: `rowbly -C "$ROWBLY_ROOT" --json story update ${story.id} --stage DONE` }),
      tool("report_result", { outcome: "complete", summary: "Moved", blockers: [], problems: [] }),
      fauxAssistantMessage("Done"),
    ]);
    const run = f.manager.run();
    try {
      await vi.waitFor(
        async () => {
          const threads = await workersOf(story.id);
          expect(threads).toHaveLength(2);
          expect(threads.map((t) => t.status)).toEqual(["completed", "completed"]);
        },
        { timeout: 20000, interval: 50 },
      );
      const threads = await workersOf(story.id);
      expect(threads.map((t) => t.runs.length)).toEqual([1, 1]);
      expect(threads[0]?.session.id).not.toBe(threads[1]?.session.id);
      expect(threads.map((t) => t.attemptNumber)).toEqual([1, 2]);
      expect(requestIds()).toEqual([`${story.id}:WORK:1`, `${story.id}:WORK:2`]);
      expect((await getStory({ id: story.id }, { cwd: root })).stage).toBe("DONE");
    } finally {
      await f.manager.shutdown();
      await run;
    }
  }, 30000);
  it("releases a parked Story, and the next pass starts a worker for it", async () => {
    const story = await createStory({ title: "Parked", stage: "WORK" }, { cwd: root });
    await updateFactoryState(root, (state) => ({
      ...state,
      parked: { [story.id]: { stage: "WORK", hash: storyHash(story), reason: "test", since: "", reported: true } },
    }));
    const f = await fixture();
    f.worker.setResponses(completeWorker());
    const run = f.manager.run();
    try {
      await vi.waitFor(async () => expect((await f.manager.snapshot()).phase).toBe("ready"));
      expect((await f.manager.reconcile()).find((d) => d.story === story.id)?.reason).toBe("parked");
      expect(await workersOf(story.id)).toEqual([]);
      expect(await f.manager.releaseStory("TST-999")).toEqual({ storyId: "TST-999", released: false });
      expect(await f.manager.releaseStory(story.id)).toEqual({ storyId: story.id, released: true });
      expect((await readFactoryState(root)).parked?.[story.id]).toBeUndefined();
      await workerStarted(story.id);
    } finally {
      await f.manager.shutdown();
      await run;
    }
  });
  it("loads an old state file with notes and report flags, and an old status file with holds", async () => {
    const story = await createStory({ title: "Old files", stage: "WORK" }, { cwd: root });
    const paths = projectPaths(root);
    await prepareRuntime(paths);
    await updateFactoryState(root, (state) => ({
      ...state,
      notes: ["Old note"],
      attempts: [
        {
          story: "TST-998",
          stage: "WORK",
          workerId: "old",
          status: "completed",
          reported: true,
          startReported: true,
        },
      ],
      parked: { "TST-997": { stage: "WORK", hash: "old", reason: "old", since: "", reported: true } },
    }));
    await writeFile(
      await runtimePath(paths, "status.json"),
      JSON.stringify({
        version: 1,
        phase: "stopped",
        supervisorThreadId: "old-supervisor",
        holds: {
          [story.id]: { stage: "WORK", reason: "Old hold", reconsiderAt: new Date(Date.now() + 60_000).toISOString() },
        },
        deliveredReportIds: ["old"],
        lastDigestHash: "old",
        unanswered: 3,
        nextWakeAt: Date.now() + 60_000,
        attention: [["check", { text: "Check is pending" }]],
      }),
    );
    const f = await fixture();
    const snapshot = await f.manager.snapshot();
    expect(snapshot.attention).toEqual([["check", { text: "Check is pending" }]]);
    for (const key of [
      "holds",
      "deliveredReportIds",
      "lastDigestHash",
      "unanswered",
      "nextWakeAt",
      "supervisorThreadId",
    ])
      expect(snapshot).not.toHaveProperty(key);
    // The old hold has no effect.
    expect((await f.manager.reconcile()).find((d) => d.story === story.id)?.action).toBe("start");
    expect((await readFactoryState(root)).notes).toEqual(["Old note"]);
  });
});
