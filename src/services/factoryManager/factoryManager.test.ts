import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCliShim } from "../../commands/factoryRunner/factoryRunner.js";
import { pendingReports } from "../factoryPolicy/factoryPolicy.js";
import { updateFactorySettings } from "../factorySettings/factorySettings.js";
import { readFactoryState, updateFactoryState } from "../factoryState/factoryState.js";
import { loadPi } from "../piRuntime/piRuntime.js";
import { initProject } from "../project/project.js";
import { createStage } from "../stage/stage.js";
import { createStory, getStory, updateStory } from "../story/story.js";
import { promptHash } from "../supervisorDigest/supervisorDigest.js";
import { useTempDir } from "../testProject/testProject.js";
import { listThreads } from "../thread/thread.js";
import { createFactoryManager, type FactoryManager } from "./factoryManager.js";

const exec = promisify(execFile);
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
      { label: "Work", key: "WORK", prompt: "Move this Story to Done. Report complete." },
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
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  async function fixture(beforeLaunch?: Parameters<typeof createFactoryManager>[0]["beforeLaunch"], classify = true) {
    const sdk = await loadPi();
    const runtime = await sdk.ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    const supervisor = fauxProvider({
      provider: "supervisor",
      api: "supervisor-faux",
      tokenSize: { min: 1000, max: 1000 },
    });
    const worker = fauxProvider({ provider: "worker", api: "worker-faux", tokenSize: { min: 1000, max: 1000 } });
    runtime.registerNativeProvider(supervisor.provider);
    runtime.registerNativeProvider(worker.provider);
    await updateFactorySettings(
      {
        maxWorkers: 1,
        supervisorModel: { provider: supervisor.getModel().provider, modelId: supervisor.getModel().id },
        workerModel: { provider: worker.getModel().provider, modelId: worker.getModel().id },
      },
      { cwd: root },
    );
    if (classify)
      await updateFactoryState(root, (state) => ({
        ...state,
        prompts: { WORK: { hash: promptHash("Move this Story to Done. Report complete."), class: "work" } },
      }));
    const shim = await createCliShim(
      {
        executable: process.execPath,
        execArgv: ["--import", resolve("node_modules/tsx/dist/loader.mjs")],
        entry: resolve("src/cli.ts"),
      },
      { cwd: root },
    );
    manager = await createFactoryManager(
      { runtime, agentDir: join(dir.path, "agent"), shim, skillsDir: resolve("skills"), beforeLaunch },
      { cwd: root },
    );
    return { supervisor, worker, shim, manager };
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
  it("moves one Story through independent real Pi sessions and the exact CLI shim", async () => {
    const story = await createStory({ title: "Complete me", stage: "WORK" }, { cwd: root });
    const f = await fixture();
    f.supervisor.setResponses([
      tool("start_worker", { storyId: story.id, stage: "WORK", requestId: "one" }),
      fauxAssistantMessage("Wait"),
      fauxAssistantMessage("Done"),
    ]);
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
      expect(new Set(threads.map((t) => t.session.id)).size).toBe(2);
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
  });
  it("resumes the exact session and v1 attempt with a new run", async () => {
    const story = await createStory({ title: "Resume", stage: "WORK" }, { cwd: root });
    const f = await fixture();
    f.worker.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "simulated" })]);
    await f.manager.reserveWorker({ storyId: story.id, stage: "WORK", requestId: "first" });
    const previous = await settled();
    await vi.waitFor(async () => expect((await f.manager.snapshot()).workers.running).toBe(0));
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
    const f = await fixture();
    const model = vi.fn();
    f.supervisor.setResponses([
      () => {
        model();
        return fauxAssistantMessage("Unexpected");
      },
    ]);
    const run = f.manager.run();
    try {
      await vi.waitFor(async () => expect((await f.manager.snapshot()).phase).toBe("ready"));
      for (let i = 0; i < 10; i++) await writeFile(join(root, ".rowbly/ROWBLY.md"), `# Instructions ${i}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(model).not.toHaveBeenCalled();
    } finally {
      await f.manager.shutdown();
      await run;
    }
  });
  it("classifies the fresh prompt through real Pi tools before a reservation", async () => {
    const story = await createStory({ title: "Classify me", stage: "WORK" }, { cwd: root });
    const f = await fixture(undefined, false);
    await expect(f.manager.reserveWorker({ storyId: story.id, stage: "WORK", requestId: "early" })).rejects.toThrow(
      "not eligible",
    );
    f.supervisor.setResponses([
      tool("classify_stage", { stage: "WORK", promptHash: "expired", class: "work" }),
      tool("classify_stage", {
        stage: "WORK",
        promptHash: promptHash("Move this Story to Done. Report complete."),
        class: "work",
      }),
      tool("start_worker", { storyId: story.id, stage: "WORK", requestId: "classified" }),
      fauxAssistantMessage("Wait"),
      fauxAssistantMessage("Done"),
    ]);
    f.worker.setResponses([
      tool("report_result", { outcome: "complete", summary: "WORKER_PRIVATE", blockers: [], problems: [] }),
      fauxAssistantMessage("Done"),
    ]);
    const run = f.manager.run();
    try {
      expect((await settled())?.status).toBe("completed");
      const supervisor = (await listThreads({ role: "supervisor" }, { cwd: root })).threads[0];
      const history = await readFile(join(root, ".rowbly/runtime", supervisor?.session.file as string), "utf8");
      expect(history).toContain("Stage prompt changed");
      expect(history).not.toContain('"name":"bash"');
    } finally {
      await f.manager.shutdown();
      await run;
    }
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
  it("quota pause does not block a worker with another provider", async () => {
    const story = await createStory({ title: "Quota", stage: "WORK" }, { cwd: root });
    const other = await createStory({ title: "Other provider", stage: "WORK" }, { cwd: root });
    const f = await fixture();
    f.worker.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "429 usage limit" })]);
    await f.manager.reserveWorker({ storyId: story.id, stage: "WORK", requestId: "quota" });
    await settled();
    await vi.waitFor(async () => expect((await f.manager.snapshot()).workers.running).toBe(0));
    expect((await f.manager.snapshot()).providers.worker?.reason).toBe("quota");
    await expect(f.manager.reserveWorker({ storyId: other.id, stage: "WORK", requestId: "paused" })).rejects.toThrow(
      "paused",
    );
    f.supervisor.setResponses([
      tool("report_result", { outcome: "complete", summary: "Other provider", blockers: [], problems: [] }),
      fauxAssistantMessage("Done"),
    ]);
    await f.manager.reserveWorker({
      storyId: other.id,
      stage: "WORK",
      requestId: "other",
      model: { provider: f.supervisor.getModel().provider, modelId: f.supervisor.getModel().id },
    });
    await vi.waitFor(async () =>
      expect((await listThreads({ story: other.id }, { cwd: root })).threads[0]?.status).toBe("completed"),
    );
    await f.manager.retryProvider("worker");
    expect((await f.manager.snapshot()).providers.worker).toBeUndefined();
  });
  it("holds a candidate and saves notes and attention through real Pi tools", async () => {
    const story = await createStory({ title: "Hold", stage: "WORK" }, { cwd: root });
    const f = await fixture();
    f.supervisor.setResponses([
      tool("hold_candidate", {
        storyId: story.id,
        stage: "WORK",
        reason: "Wait for check",
        reconsiderAt: new Date(Date.now() + 60_000).toISOString(),
      }),
      tool("save_note", { text: "Check later" }),
      tool("raise_attention", { key: "check", text: "Check is pending", storyId: story.id }),
      fauxAssistantMessage("Wait"),
      fauxAssistantMessage("Wait"),
    ]);
    const run = f.manager.run();
    try {
      await vi.waitFor(async () => expect((await readFactoryState(root)).notes).toEqual(["Check later"]));
      await expect(f.manager.reserveWorker({ storyId: story.id, stage: "WORK", requestId: "held" })).rejects.toThrow(
        "held",
      );
      expect((await f.manager.snapshot()).holds[story.id]?.reason).toBe("Wait for check");
    } finally {
      await f.manager.shutdown();
      await run;
    }
  });
  it("failed digest remains unacknowledged while other workers survive", async () => {
    const story = await createStory({ title: "Report", stage: "WORK" }, { cwd: root });
    const f = await fixture();
    f.worker.setResponses([
      tool("report_result", { outcome: "complete", summary: "Report me", blockers: [], problems: [] }),
      fauxAssistantMessage("Done"),
    ]);
    await f.manager.reserveWorker({ storyId: story.id, stage: "WORK", requestId: "report" });
    await settled();
    f.supervisor.setResponses([
      fauxAssistantMessage("", { stopReason: "error", errorMessage: "Simulated supervisor failure" }),
    ]);
    const run = f.manager.run();
    try {
      await vi.waitFor(async () =>
        expect(JSON.stringify((await f.manager.snapshot()).attention)).toContain("Supervisor turn failed"),
      );
      expect(pendingReports(await readFactoryState(root)).length).toBeGreaterThan(0);
      expect((await f.manager.snapshot()).phase).toBe("ready");
    } finally {
      await f.manager.shutdown();
      await run;
    }
  });
  it("rotation reconstructs operational notes without the previous conversation", async () => {
    const story = await createStory({ title: "Rotate", stage: "WORK" }, { cwd: root });
    const f = await fixture();
    f.supervisor.setResponses([
      tool("save_note", { text: "Persistent operational fact" }),
      fauxAssistantMessage("Previous conversation private text"),
      fauxAssistantMessage("Fresh supervisor"),
    ]);
    const now = Date.now.bind(Date);
    let offset = 0;
    const date = vi.spyOn(Date, "now").mockImplementation(() => now() + offset);
    const run = f.manager.run();
    try {
      await vi.waitFor(async () =>
        expect((await readFactoryState(root)).notes).toEqual(["Persistent operational fact"]),
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      offset = 25 * 60 * 60_000;
      await updateStory({ id: story.id, title: "Rotate now" }, { cwd: root });
      await vi.waitFor(async () =>
        expect((await listThreads({ role: "supervisor" }, { cwd: root })).threads).toHaveLength(2),
      );
      const threads = (await listThreads({ role: "supervisor" }, { cwd: root })).threads;
      const current = threads.find((t) => t.parentThreadId);
      await vi.waitFor(async () => {
        const text = await readFile(join(root, ".rowbly/runtime", current?.session.file as string), "utf8");
        expect(text).toContain("Persistent operational fact");
        expect(text).not.toContain("Previous conversation private text");
      });
    } finally {
      date.mockRestore();
      await f.manager.shutdown();
      await run;
    }
  });
});
