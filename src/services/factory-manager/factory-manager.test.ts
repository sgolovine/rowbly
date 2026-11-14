import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCliShim } from "../../commands/factory-runner/factory-runner.js";
import { pendingReports } from "../factory-policy/factory-policy.js";
import { getFactorySettings, updateFactorySettings } from "../factory-settings/factory-settings.js";
import { readFactoryState, updateFactoryState } from "../factory-state/factory-state.js";
import { loadPi } from "../pi-runtime/pi-runtime.js";
import { initProject } from "../project/project.js";
import { commitCanonicalProject } from "../project-write/project-write.js";
import { prepareRuntime, runtimePath } from "../runtime-files/runtime-files.js";
import { createStage } from "../stage/stage.js";
import { createStory, getStory, updateStory } from "../story/story.js";
import { promptHash } from "../supervisor-digest/supervisor-digest.js";
import { useTempDir } from "../test-project/test-project.js";
import { listThreads } from "../thread/thread.js";
import { projectPaths } from "../workspace/workspace.js";
import { createFactoryManager, type FactoryManager } from "./factory-manager.js";
import { readAuthStamp } from "./manager-state.js";
import { scan } from "./manager-status.js";
import { startProjectSync } from "./project-sync-step.js";

vi.mock("../project-write/project-write.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../project-write/project-write.js")>();
  return { ...actual, commitCanonicalProject: vi.fn(actual.commitCanonicalProject) };
});
vi.mock("./manager-state.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./manager-state.js")>();
  return { ...actual, readAuthStamp: vi.fn(actual.readAuthStamp) };
});
vi.mock("./manager-status.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./manager-status.js")>();
  return { ...actual, scan: vi.fn(actual.scan) };
});
vi.mock("./project-sync-step.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./project-sync-step.js")>();
  return { ...actual, startProjectSync: vi.fn(actual.startProjectSync) };
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
    for (const mocked of [commitCanonicalProject, readAuthStamp, scan, startProjectSync, getFactorySettings])
      vi.mocked(mocked).mockReset();
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
      { runtime, agentDir: join(dir.path, "agent"), shim, beforeLaunch },
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
      // The status file lists queued work for the TUI, without the Stories that wait for no worker.
      const status = JSON.parse(await readFile(join(root, ".rowbly/runtime/status.json"), "utf8"));
      expect(status.queue).toContainEqual(expect.objectContaining({ story: other.id, reason: "worker limit" }));
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
    f.supervisor.setResponses([fauxAssistantMessage("Wait"), fauxAssistantMessage("Wait")]);
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
  it("uses Story and Stage worker model overrides before the start_worker model", async () => {
    const staged = await createStory({ title: "Stage override", stage: "WORK" }, { cwd: root });
    const pinned = await createStory({ title: "Story override", stage: "WORK" }, { cwd: root });
    await updateFactorySettings(
      {
        stageWorkerModels: { WORK: { provider: "supervisor", modelId: "faux-1" } },
        storyWorkerModels: { [pinned.id]: { WORK: { provider: "worker", modelId: "faux-1" } } },
      },
      { cwd: root },
    );
    const f = await fixture();
    expect(f.supervisor.getModel().id).toBe("faux-1");
    f.supervisor.setResponses([fauxAssistantMessage("RESULT: complete")]);
    await f.manager.reserveWorker({
      storyId: staged.id,
      stage: "WORK",
      requestId: "stage-override",
      model: { provider: f.worker.getModel().provider, modelId: f.worker.getModel().id },
    });
    expect((await settled())?.model).toEqual({ provider: "supervisor", modelId: "faux-1" });
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
      await vi.waitFor(async () => {
        const threads = (await listThreads({ role: "supervisor" }, { cwd: root })).threads;
        const current = threads.find((t) => t.parentThreadId);
        expect(current?.session.file).toBeTruthy();
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
  async function attentionOf(f: { manager: FactoryManager }) {
    return new Map((await f.manager.snapshot()).attention as [string, { text: string }][]);
  }
  it("delivers a digest with the unclassified Stage while the commit step throws on each pass", async () => {
    const hash = promptHash("Move this Story to Done. Report complete.");
    await createStory({ title: "Unclassified", stage: "WORK" }, { cwd: root });
    const long = `Project write lock is unavailable ${"x".repeat(1000)}`;
    vi.mocked(commitCanonicalProject).mockRejectedValue(new Error(long));
    const f = await fixture(undefined, false);
    const digests: string[] = [];
    f.supervisor.setResponses([
      (context) => {
        digests.push(JSON.stringify(context.messages.at(-1)));
        return fauxAssistantMessage("Wait");
      },
    ]);
    const run = f.manager.run();
    try {
      await vi.waitFor(() => expect(digests).toHaveLength(1), { timeout: 10000, interval: 20 });
      expect(digests[0]).toContain("unclassified");
      expect(digests[0]).toContain(hash);
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
  ])("delivers the digest when the %s step throws, and records the error", async (key, label, breakStep) => {
    await createStory({ title: "Step failure", stage: "WORK" }, { cwd: root });
    const f = await fixture(undefined, false);
    const digests: string[] = [];
    f.supervisor.setResponses([
      (context) => {
        digests.push(JSON.stringify(context.messages.at(-1)));
        return fauxAssistantMessage("Wait");
      },
    ]);
    breakStep();
    const run = f.manager.run();
    try {
      await vi.waitFor(() => expect(digests).toHaveLength(1), { timeout: 10000, interval: 20 });
      expect(digests[0]).toContain("unclassified");
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
    f.supervisor.setResponses([fauxAssistantMessage("Wait"), fauxAssistantMessage("Wait")]);
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
});
