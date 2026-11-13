import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCliShim } from "../../commands/factoryRunner/factoryRunner.js";
import { updateFactorySettings } from "../factorySettings/factorySettings.js";
import { readFactoryState } from "../factoryState/factoryState.js";
import { loadPi } from "../piRuntime/piRuntime.js";
import { initProject } from "../project/project.js";
import { createStage } from "../stage/stage.js";
import { createStory, getStory, updateStory } from "../story/story.js";
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
  async function fixture(beforeLaunch?: Parameters<typeof createFactoryManager>[0]["beforeLaunch"]) {
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
        expect(["completed", "failed", "interrupted"]).toContain(workers[0]?.status);
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
    expect(
      await f.manager.reserveWorker({
        storyId: story.id,
        stage: "WORK",
        requestId: "resume",
        resumeThreadId: previous?.id,
      }),
    ).toEqual({ threadId: previous?.id });
    await vi.waitFor(async () =>
      expect((await listThreads({ role: "worker" }, { cwd: root })).threads[0]?.status).toBe("completed"),
    );
    const current = (await listThreads({ role: "worker" }, { cwd: root })).threads[0];
    expect(current?.session).toEqual(previous?.session);
    expect(current?.runs).toHaveLength(2);
    expect((await readFactoryState(root)).attempts).toHaveLength(1);
  });
});
