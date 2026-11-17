import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initProject } from "../project/project.js";
import { createStage } from "../stage/stage.js";
import { createStory } from "../story/story.js";
import { useTempDir } from "../test-project/test-project.js";
import { getThread, listThreads } from "../thread/thread.js";
import { createFactoryManager, type FactoryManager } from "./factory-manager.js";
import type { WorkerEvents, WorkerExecutor, WorkerLaunch } from "./worker-executor.js";

// The fake executor must not load Pi.
vi.mock("@earendil-works/pi-coding-agent", () => {
  throw new Error("Pi loaded by the fake executor");
});

const PROMPT = "Move this Story to Done. Report complete.";
const model = { provider: "fake", modelId: "fake-model" };
const usage = { input: 10, output: 20, cacheRead: 1, cacheWrite: 2, cost: 0.5 };

interface FakeExecutor extends WorkerExecutor {
  readonly messages: string[];
  readonly unblock: () => void;
}

/** Emits each event of a worker run. With `wait`, the run stays open until a stop or a cancel. */
function fakeExecutor(root: string, wait = false): FakeExecutor {
  const messages: string[] = [];
  let release = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const executor: FakeExecutor = {
    messages,
    unblock: () => release(),
    launch: vi.fn(async (launch: WorkerLaunch, events: WorkerEvents) => {
      try {
        const worktree = join(root, "..", "worktrees", launch.story.id);
        await events.worktreeReady({ path: worktree, branch: `story/${launch.story.id}` });
        await events.sessionOpened({ model, file: `sessions/${launch.thread.id}/session.jsonl` });
        messages.push(await events.message(worktree, model));
        await events.activity({ lastActivityAt: new Date().toISOString(), lastTool: "bash", usage });
        events.prompted(model);
        if (wait) await blocked;
        else await events.resultReported({ outcome: "complete", summary: "Fake done", blockers: [], problems: [] });
        await events.completed(
          wait ? undefined : { outcome: "complete", summary: "Fake done", blockers: [], problems: [] },
        );
      } catch (error) {
        await events.failed({ error, sessionOpened: true });
      } finally {
        await events.finished({ lastActivityAt: new Date().toISOString(), lastTool: "edit", usage });
      }
    }),
    stop: vi.fn(async () => release()),
    cancel: vi.fn(async () => release()),
    steer: vi.fn(async () => {}),
  };
  return executor;
}

describe("worker executor", () => {
  const dir = useTempDir();
  let root: string;
  let manager: FactoryManager | undefined;

  beforeEach(async () => {
    root = join(dir.path, "project");
    await mkdir(root);
    vi.stubEnv("HOME", join(dir.path, "home"));
    await initProject({ name: "Test", key: "TST" }, { cwd: root });
    await createStage({ label: "Work", key: "WORK", prompt: PROMPT, position: 2 }, { cwd: root });
  });

  afterEach(async () => {
    await manager?.shutdown();
    manager = undefined;
    vi.unstubAllEnvs();
  });

  async function start(executor: WorkerExecutor) {
    manager = await createFactoryManager(
      {
        runtime: { settleCredentialWrites: async () => {} } as never,
        agentDir: join(dir.path, "agent"),
        shim: join(dir.path, "rowbly"),
        maxWorkers: 1,
        executor,
      },
      { cwd: root },
    );
    return manager;
  }

  async function workerThread() {
    return (await listThreads({ role: "worker" }, { cwd: root })).threads[0];
  }

  it("writes the events of the executor into the Thread and completes it", async () => {
    const story = await createStory({ title: "Fake", stage: "WORK" }, { cwd: root });
    const executor = fakeExecutor(root);
    const factory = await start(executor);

    const { threadId } = await factory.reserveWorker({ storyId: story.id, stage: "WORK", requestId: "one" });

    await vi.waitFor(async () => expect((await getThread(threadId, { cwd: root })).status).toBe("completed"), {
      timeout: 5000,
      interval: 20,
    });
    await vi.waitFor(async () => expect((await getThread(threadId, { cwd: root })).lastTool).toBe("edit"));
    await vi.waitFor(async () => expect((await factory.snapshot()).workers.running).toBe(0));
    const thread = await getThread(threadId, { cwd: root });

    expect(executor.launch).toHaveBeenCalledOnce();
    expect(thread.worktree).toBe(join(root, "..", "worktrees", story.id));
    expect(thread.branch).toBe(`story/${story.id}`);
    expect(thread.model).toEqual(model);
    expect(thread.session.file).toBe(`sessions/${threadId}/session.jsonl`);
    expect(thread.lastTool).toBe("edit");
    expect(thread.usage).toEqual(usage);
    expect(thread.result?.summary).toBe("Fake done");
    expect(thread.result?.problems).toContain("Story remains in the assigned Stage");
    expect(executor.messages[0]).toContain(story.id);
    expect(executor.messages[0]).toContain("fake/fake-model");
  });

  it("cancels a running worker through the executor", async () => {
    const story = await createStory({ title: "Cancel", stage: "WORK" }, { cwd: root });
    const executor = fakeExecutor(root, true);
    const factory = await start(executor);

    const { threadId } = await factory.reserveWorker({ storyId: story.id, stage: "WORK", requestId: "two" });

    await vi.waitFor(async () => expect((await getThread(threadId, { cwd: root })).lastTool).toBe("bash"), {
      timeout: 5000,
      interval: 20,
    });
    const runId = (await workerThread())?.runs.at(-1)?.id ?? "missing";

    await factory.cancelWorker(threadId, runId);

    expect(executor.cancel).toHaveBeenCalledExactlyOnceWith(threadId);
    expect(executor.stop).not.toHaveBeenCalled();
    await vi.waitFor(async () => expect((await getThread(threadId, { cwd: root })).usage).toEqual(usage));
    expect((await getThread(threadId, { cwd: root })).status).toBe("cancelled");
  });

  it("steers a running worker through the executor", async () => {
    const story = await createStory({ title: "Steer", stage: "WORK" }, { cwd: root });
    const executor = fakeExecutor(root, true);
    const factory = await start(executor);

    const { threadId } = await factory.reserveWorker({ storyId: story.id, stage: "WORK", requestId: "three" });

    await vi.waitFor(async () => expect((await getThread(threadId, { cwd: root })).lastTool).toBe("bash"), {
      timeout: 5000,
      interval: 20,
    });
    const runId = (await workerThread())?.runs.at(-1)?.id ?? "missing";

    await factory.steerWorker(threadId, runId, "Use the new API");

    expect(executor.steer).toHaveBeenCalledOnce();
    expect(vi.mocked(executor.steer).mock.calls[0]?.[0]).toBe(threadId);
    expect(vi.mocked(executor.steer).mock.calls[0]?.[1]).toContain("Use the new API");
    executor.unblock();
  });
});
