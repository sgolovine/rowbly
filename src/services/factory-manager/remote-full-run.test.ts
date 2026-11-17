import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCliShim } from "../../commands/factory-runner/cli-shim.js";
import { createCliShim } from "../../commands/factory-runner/factory-runner.js";
import { HOST_SYNC_REASON } from "../factory-policy/factory-policy.js";
import { updateFactorySettings } from "../factory-settings/factory-settings.js";
import { hostAgentPaths, threadPaths } from "../host-agent/host-agent-paths.js";
import { readHostRun } from "../host-agent/host-run-state.js";
import { createHostRunner } from "../host-agent/host-runner.js";
import { hostProjectId } from "../host-project/host-paths.js";
import { readOutboxEntries } from "../outbox/outbox-file.js";
import { loadPi } from "../pi-runtime/pi-runtime.js";
import { initProject } from "../project/project.js";
import { createStage } from "../stage/stage.js";
import { createStory, getStory } from "../story/story.js";
import { createFakeHostAgent, type FakeHostAgent } from "../test-project/fake-host-agent.js";
import { useTempDir } from "../test-project/test-project.js";
import { getThread, type ThreadRecord } from "../thread/thread.js";
import { createFactoryManager, type FactoryManager } from "./factory-manager.js";

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

async function commit(cwd: string, file: string, text: string) {
  await writeFile(join(cwd, file), text);
  await git(cwd, "add", file);
  await git(cwd, "-c", "user.name=Test", "-c", "user.email=t@example.com", "commit", "-q", "-m", file);
}

describe("factory manager with a host agent", () => {
  const dir = useTempDir();
  let manager: FactoryManager | undefined;
  let host: FakeHostAgent | undefined;
  let root: string;
  let home: string;

  beforeEach(async () => {
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

    // The clone of the Project on the worker host, with an origin that the host fetches before each run.
    const seed = join(dir.path, "seed");
    await mkdir(seed);
    await git(seed, "init", "-q", "-b", "main");
    await commit(seed, "README.md", "seed\n");
    await exec("git", ["clone", "-q", "--bare", seed, join(dir.path, "origin.git")]);
    await exec("git", ["clone", "-q", join(dir.path, "origin.git"), join(home, CLONE)]);
  });

  afterEach(async () => {
    await manager?.shutdown();
    await host?.stop();
    manager = undefined;
    host = undefined;
    vi.unstubAllEnvs();
  });

  async function fixture() {
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
    const agent = createFakeHostAgent({
      projectId,
      home,
      runner: createHostRunner({
        paths: hostAgentPaths(projectId, home),
        home,
        shim: await hostShim(projectId),
        runtime: async () => ({ runtime, agentDir: join(dir.path, "agent") }),
      }),
    });
    host = agent;
    manager = await createFactoryManager(
      {
        runtime,
        agentDir: join(dir.path, "agent"),
        shim: await createCliShim(LAUNCH, { cwd: root }),
        workerHosts: async () => HOSTS,
        worktreeFacts: async () => undefined,
        hostConnection: async () => ({ transport: agent.transport, rowbly: ROWBLY, clone: CLONE }),
      },
      { cwd: root },
    );
    return { manager, worker, host: agent };
  }

  async function hostShim(projectId: string): Promise<string> {
    const bin = hostAgentPaths(projectId, home).bin;
    await mkdir(join(bin, ".."), { recursive: true });
    return writeCliShim(LAUNCH, bin);
  }

  function moveAndReport(worker: ReturnType<typeof fauxProvider>, storyId: string) {
    worker.setResponses([
      tool("bash", { command: `rowbly -C "$ROWBLY_ROOT" --json story update ${storyId} --stage DONE` }),
      tool("report_result", { outcome: "complete", summary: "Moved on mini", blockers: [], problems: [] }),
      fauxAssistantMessage("Done"),
    ]);
  }

  async function completed(id: string): Promise<ThreadRecord> {
    return vi.waitFor(
      async () => {
        const thread = await getThread(id, { cwd: root });
        expect(thread.status).toBe("completed");
        return thread;
      },
      { timeout: 45_000, interval: 50 },
    );
  }

  async function freeSlot(f: { manager: FactoryManager }) {
    await vi.waitFor(async () => expect((await f.manager.snapshot()).hosts[1]).toMatchObject({ id: "mini", used: 0 }), {
      timeout: 10_000,
      interval: 20,
    });
  }

  it("runs a worker in the host agent, applies its outbox before the end, and frees the slot of the host", async () => {
    const f = await fixture();
    const story = await createStory({ title: "Remote", stage: "WORK" }, { cwd: root });
    moveAndReport(f.worker, story.id);

    const { threadId } = await f.manager.reserveWorker({
      storyId: story.id,
      stage: "WORK",
      requestId: "r",
      host: "mini",
    });
    const thread = await completed(threadId);

    expect(thread).toMatchObject({
      host: "mini",
      worktree: join(home, `${CLONE}-worktrees`, story.id),
      branch: `story/${story.id}`,
      session: { file: expect.stringMatching(new RegExp(`^sessions/${threadId}/`)) },
      result: { outcome: "complete", summary: "Moved on mini" },
      usage: { input: expect.any(Number), output: expect.any(Number) },
    });
    // The outbox entry with the Stage move was applied before the Thread completed.
    expect(thread.result?.problems).not.toContain("Story remains in the assigned Stage");
    expect((await getStory({ id: story.id }, { cwd: root })).stage).toBe("DONE");
    expect(await readOutboxEntries(f.host.paths.outbox, 0)).toEqual([]);
    await freeSlot(f);

    const launch = JSON.parse(await readFile(threadPaths(f.host.paths, threadId).launch, "utf8"));
    const copy = threadPaths(f.host.paths, threadId).copy;
    expect(launch.message).toContain(`-C '${copy}' --json`);
    expect(launch.message).toContain(`'${threadPaths(f.host.paths, threadId).lock}' '${f.host.paths.bin}'`);
    const base = join(root, ".rowbly/runtime/hosts/mini/threads", threadId, "base.json");
    expect(JSON.parse(await readFile(base, "utf8"))).toMatchObject({ version: 1, threadId, host: "mini" });
    expect((await stat(base)).mode & 0o777).toBe(0o600);
  }, 60_000);

  it("raises the worker attention entry for a blocker that a remote worker reports", async () => {
    const f = await fixture();
    const story = await createStory({ title: "Remote blocker", stage: "WORK" }, { cwd: root });
    f.worker.setResponses([
      tool("report_result", { outcome: "blocked", summary: "Blocked", blockers: ["Needs a key"], problems: [] }),
      fauxAssistantMessage("Done"),
    ]);

    const { threadId } = await f.manager.reserveWorker({
      storyId: story.id,
      stage: "WORK",
      requestId: "r",
      host: "mini",
    });
    await completed(threadId);
    await freeSlot(f);

    const attention = new Map((await f.manager.snapshot()).attention as [string, { text: string; storyId?: string }][]);
    const entry = attention.get(`worker:${story.id}`);
    expect(entry?.storyId).toBe(story.id);
    expect(entry?.text).toContain(`${story.id} in WORK: worker ${threadId}`);
    expect(entry?.text).toContain("Needs a key");
  }, 60_000);

  it("waits for the host sync after a failed outbox apply, and the next scan applies it and completes the Thread", async () => {
    const f = await fixture();
    const story = await createStory({ title: "Remote", stage: "WORK" }, { cwd: root });
    moveAndReport(f.worker, story.id);
    f.host.failOutbox(true);

    const { threadId } = await f.manager.reserveWorker({
      storyId: story.id,
      stage: "WORK",
      requestId: "r",
      host: "mini",
    });
    await vi.waitFor(async () => expect((await readHostRun(f.host.paths, threadId))?.phase).toBe("ended"), {
      timeout: 45_000,
      interval: 50,
    });
    await vi.waitFor(() => expect(f.host.calls.some((call) => call[2] === "outbox")).toBe(true), {
      timeout: 10_000,
      interval: 20,
    });

    expect((await getThread(threadId, { cwd: root })).status).toBe("running");
    expect((await getStory({ id: story.id }, { cwd: root })).stage).toBe("WORK");
    expect((await f.manager.reconcile()).find((d) => d.story === story.id)?.reason).toBe(HOST_SYNC_REASON);
    expect((await f.manager.snapshot()).attention).toContainEqual([
      "host-sync:mini",
      { text: expect.stringContaining("Outbox sync of host mini failed") },
    ]);
    expect((await getThread(threadId, { cwd: root })).status).toBe("running");

    f.host.failOutbox(false);
    await f.manager.reconcile();
    const thread = await completed(threadId);

    expect(thread.result?.problems).not.toContain("Story remains in the assigned Stage");
    expect((await getStory({ id: story.id }, { cwd: root })).stage).toBe("DONE");
    await freeSlot(f);
    expect((await f.manager.reconcile()).find((d) => d.story === story.id)?.reason).not.toBe(HOST_SYNC_REASON);
  }, 60_000);
});
