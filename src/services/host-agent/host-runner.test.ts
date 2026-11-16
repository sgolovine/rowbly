import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import {
  type AssistantMessage,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  InMemoryCredentialStore,
} from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCliShim } from "../../commands/factory-runner/cli-shim.js";
import { readOutboxEntries } from "../outbox/outbox-file.js";
import { loadPi } from "../pi-runtime/pi-runtime.js";
import { initProject } from "../project/project.js";
import { createStage } from "../stage/stage.js";
import { createStory, getStory } from "../story/story.js";
import { createFakeHostTransport } from "../test-project/fake-host-transport.js";
import { useTempDir } from "../test-project/test-project.js";
import type { ThreadRecord } from "../thread/thread.js";
import { buildThreadCopy } from "../thread-copy/thread-copy.js";
import { type HostAgentResult, runHostAgent } from "./host-agent.js";
import { submitHostCommand } from "./host-agent-control.js";
import { hostAgentPaths, prepareAgentDirs, threadPaths } from "./host-agent-paths.js";
import { prepareHostThread } from "./host-agent-prepare.js";
import type { HostWorkRunner } from "./host-agent-work.js";
import { runHostAttach } from "./host-attach.js";
import { readHostRun } from "./host-run-state.js";
import { createHostRunner } from "./host-runner.js";
import { slotUsage, writeSlotLimit } from "./host-slots.js";

const exec = promisify(execFile);
const git = (cwd: string, ...args: string[]) => exec("git", ["-C", cwd, ...args]);
const tool = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
const report = tool("report_result", { outcome: "complete", summary: "Done", blockers: [], problems: [] });
const CLONE = ".local/share/rowbly/projects/p1/repo";

/** A response that waits until Pi aborts the request. */
function blocking(started: { count: number }) {
  return (_context: unknown, options: { signal?: AbortSignal } | undefined) =>
    new Promise<AssistantMessage>((done) => {
      started.count += 1;
      const aborted = () => done(fauxAssistantMessage("", { stopReason: "aborted", errorMessage: "aborted" }));
      if (options?.signal?.aborted) aborted();
      options?.signal?.addEventListener("abort", aborted);
    });
}

function threadRecord(id: string, storyId: string): ThreadRecord {
  const createdAt = new Date().toISOString();
  return {
    version: 1,
    id,
    revision: 1,
    role: "worker",
    storyId,
    stage: "WORK",
    status: "pending",
    createdAt,
    session: { id, file: null },
    cwd: "/main/project",
    runs: [{ id: `run-${id}`, ownerToken: "owner", createdAt, status: "pending" }],
    resumable: false,
  };
}

describe("host runner", () => {
  const dir = useTempDir();
  const agents: { controller: AbortController; done: Promise<HostAgentResult> }[] = [];
  let home: string;
  let main: string;
  let seed: string;
  let clone: string;
  let storyId: string;
  let worker: ReturnType<typeof fauxProvider>;
  let runner: HostWorkRunner;
  const paths = () => hostAgentPaths("p1", home);
  const worktree = () => `${clone}-worktrees/${storyId}`;

  async function commit(cwd: string, file: string, text: string) {
    await writeFile(join(cwd, file), text);
    await git(cwd, "add", file);
    await git(cwd, "-c", "user.name=Test", "-c", "user.email=t@example.com", "commit", "-q", "-m", file);
  }

  beforeEach(async () => {
    home = join(dir.path, "home");
    main = join(dir.path, "main");
    seed = join(dir.path, "seed");
    clone = join(home, CLONE);
    await mkdir(main, { recursive: true });
    vi.stubEnv("HOME", home);
    vi.stubEnv("PI_CODING_AGENT_DIR", join(dir.path, "agent"));
    vi.stubEnv("PI_OFFLINE", "1");

    await initProject({ name: "Test", key: "TST" }, { cwd: main });
    await createStage({ label: "Work", key: "WORK", prompt: "Work." }, { cwd: main });
    storyId = (await createStory({ title: "Remote work", stage: "WORK" }, { cwd: main })).id;

    await mkdir(seed);
    await git(seed, "init", "-q", "-b", "main");
    await commit(seed, "README.md", "seed\n");
    await exec("git", ["clone", "-q", "--bare", seed, join(dir.path, "origin.git")]);
    await git(seed, "remote", "add", "origin", join(dir.path, "origin.git"));
    await exec("git", ["clone", "-q", join(dir.path, "origin.git"), clone]);

    const sdk = await loadPi();
    const runtime = await sdk.ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    worker = fauxProvider({ provider: "worker", api: "worker-faux", tokenSize: { min: 1000, max: 1000 } });
    runtime.registerNativeProvider(worker.provider);

    await prepareAgentDirs(paths());
    await mkdir(join(paths().dir, "bin"), { recursive: true });
    const shim = await writeCliShim(
      {
        executable: process.execPath,
        execArgv: ["--import", resolve("node_modules/tsx/dist/loader.mjs")],
        entry: resolve("src/cli.ts"),
      },
      paths().bin,
    );
    runner = createHostRunner({
      paths: paths(),
      home,
      shim,
      runtime: async () => ({ runtime, agentDir: join(dir.path, "agent") }),
    });
  });

  afterEach(async () => {
    const running = agents.splice(0);
    for (const agent of running) agent.controller.abort();
    await Promise.all(running.map((agent) => agent.done));
    vi.unstubAllEnvs();
  });

  async function prepare(threadId = "t1") {
    const copy = await buildThreadCopy({ storyId }, { cwd: main });
    const model = { provider: worker.getModel().provider, modelId: worker.getModel().id };
    await prepareHostThread(
      paths(),
      { threadId, thread: threadRecord(threadId, storyId), storyId, clone: CLONE, model, message: "Work", copy },
      { home },
    );
  }

  async function runDirect(kind: "launch" | "resume", threadId = "t1") {
    const work = await runner.start({ kind, projectId: "p1", threadId, requestId: `${kind}-${threadId}`, payload: {} });
    await work.ended;
    return readHostRun(paths(), threadId);
  }

  function startAgent() {
    const controller = new AbortController();
    const done = runHostAgent({ projectId: "p1", home, runner, pollMs: 10, signal: controller.signal });
    agents.push({ controller, done });
  }

  async function submit(id: string, type: string, threadId = "t1") {
    await submitHostCommand(paths(), JSON.stringify({ version: 1, id, type, threadId }));
  }

  async function ended(threadId = "t1") {
    return vi.waitFor(
      async () => {
        const run = await readHostRun(paths(), threadId);
        expect(run?.phase).toBe("ended");
        return run;
      },
      { timeout: 30_000, interval: 20 },
    );
  }

  async function slotsReleased() {
    await vi.waitFor(async () => expect((await slotUsage(home)).used).toBe(0), { timeout: 10_000, interval: 20 });
  }

  it("runs a launch: worktree, session, result, usage, the outbox write and the released slot", async () => {
    await prepare();
    await writeSlotLimit(1, home);
    worker.setResponses([
      tool("bash", { command: `rowbly -C "$ROWBLY_ROOT" --json story update ${storyId} --title Changed` }),
      report,
      fauxAssistantMessage("Done"),
    ]);

    startAgent();
    await submit("launch-1", "launch");
    const run = await ended();
    await slotsReleased();

    expect(run).toMatchObject({
      kind: "launch",
      endReason: "completed",
      worktree: { path: worktree(), branch: `story/${storyId}` },
      session: { model: { provider: "worker" }, file: expect.stringMatching(/^sessions\/t1\//) },
      result: { outcome: "complete", summary: "Done" },
      usage: { input: expect.any(Number), output: expect.any(Number) },
    });
    expect(run?.failure).toBeUndefined();
    await readFile(join(paths().runtime, run?.session?.file as string));

    const copy = threadPaths(paths(), "t1").copy;
    expect((await getStory({ id: storyId }, { cwd: copy })).title).toBe("Changed");
    const entries = await readOutboxEntries(paths().outbox, 0);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ threadId: "t1", storyId });
    expect((await git(clone, "status", "--porcelain")).stdout).toBe("");
    expect((await git(worktree(), "status", "--porcelain")).stdout).toBe("");
    const files = await readdir(clone, { recursive: true });
    expect(files.some((file) => file.includes("sessions") || file.endsWith(".jsonl"))).toBe(false);
  }, 60_000);

  it("rejects a launch or a resume without a prepared Thread and keeps no slot", async () => {
    await writeSlotLimit(1, home);
    startAgent();
    await submit("launch-x", "launch", "missing");
    await submit("resume-x", "resume", "missing");

    for (const id of ["launch-x", "resume-x"]) {
      const receipt = await vi.waitFor(
        async () => {
          const value = JSON.parse(await readFile(join(paths().receipts, `${id}.json`), "utf8"));
          expect(value.status).not.toBe("accepted");
          return value;
        },
        { timeout: 10_000, interval: 20 },
      );
      expect(receipt).toMatchObject({ status: "rejected", error: { code: "NOT_FOUND" } });
    }
    expect((await slotUsage(home)).used).toBe(0);
  }, 30_000);

  it("fetches origin and fast-forwards the clone before it makes the worktree", async () => {
    await commit(seed, "new.txt", "from origin\n");
    await git(seed, "push", "-q", "origin", "main");
    await prepare();
    worker.setResponses([report, fauxAssistantMessage("Done")]);

    const run = await runDirect("launch");

    expect(run?.endReason).toBe("completed");
    expect(await readFile(join(worktree(), "new.txt"), "utf8")).toBe("from origin\n");
  }, 60_000);

  it("fails the run when the clone cannot fast-forward, and changes no worktree", async () => {
    await commit(seed, "origin.txt", "origin\n");
    await git(seed, "push", "-q", "origin", "main");
    await commit(clone, "local.txt", "local\n");
    await prepare();

    const run = await runDirect("launch");

    expect(run).toMatchObject({ endReason: "failed", failure: { code: "CONFLICT", sessionOpened: false } });
    expect(run?.failure?.message).toContain("cannot fast-forward");
    await expect(readdir(`${clone}-worktrees`)).rejects.toMatchObject({ code: "ENOENT" });
    expect(worker.state.callCount).toBe(0);
  }, 60_000);

  it("keeps an uncommitted file of an existing worktree", async () => {
    await git(clone, "worktree", "add", "-q", "-b", `story/${storyId}`, worktree());
    await writeFile(join(worktree(), "dirty.txt"), "keep me");
    await prepare();
    worker.setResponses([report, fauxAssistantMessage("Done")]);

    const run = await runDirect("launch");

    expect(run?.endReason).toBe("completed");
    expect(await readFile(join(worktree(), "dirty.txt"), "utf8")).toBe("keep me");
  }, 60_000);

  it("stops and cancels a running worker, and a stop of a Thread without work has no effect", async () => {
    const started = { count: 0 };
    await writeSlotLimit(2, home);
    await prepare("t1");
    await prepare("t2");
    worker.setResponses([blocking(started), blocking(started)]);
    startAgent();

    await submit("stop-none", "stop-thread", "idle");
    await submit("cancel-none", "cancel-thread", "idle");
    await submit("launch-1", "launch", "t1");
    await submit("launch-2", "launch", "t2");
    await vi.waitFor(() => expect(started.count).toBe(2), { timeout: 30_000, interval: 20 });
    await submit("stop-1", "stop-thread", "t1");
    await submit("cancel-2", "cancel-thread", "t2");

    expect((await ended("t1"))?.endReason).toBe("stopped");
    expect((await ended("t2"))?.endReason).toBe("cancelled");
    await slotsReleased();
    for (const id of ["stop-none", "cancel-none"]) {
      expect(JSON.parse(await readFile(join(paths().receipts, `${id}.json`), "utf8")).status).toBe("completed");
    }
  }, 60_000);

  it("resumes with the same session file and worktree after a stop", async () => {
    const started = { count: 0 };
    await prepare();
    worker.setResponses([blocking(started)]);
    const work = await runner.start({ kind: "launch", projectId: "p1", threadId: "t1", requestId: "l1", payload: {} });
    await vi.waitFor(() => expect(started.count).toBe(1), { timeout: 30_000, interval: 20 });
    await work.stop();
    await work.ended;
    const stopped = await readHostRun(paths(), "t1");
    expect(stopped?.endReason).toBe("stopped");

    worker.setResponses([report, fauxAssistantMessage("Done")]);
    const resumed = await runDirect("resume");

    expect(resumed).toMatchObject({ kind: "resume", endReason: "completed", result: { outcome: "complete" } });
    expect(resumed?.session?.file).toBe(stopped?.session?.file);
    expect(resumed?.worktree?.path).toBe(stopped?.worktree?.path);
  }, 60_000);

  it("rejects a resume without the session file or the worktree with NOT_FOUND", async () => {
    await prepare("t2");
    await expect(
      runner.start({ kind: "resume", projectId: "p1", threadId: "t2", requestId: "r", payload: {} }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  }, 30_000);

  it("continues a run when the channel stops, and a new channel gives the result", async () => {
    const inputs: PassThrough[] = [];
    const transport = createFakeHostTransport({
      channel: (_command, remote) => {
        const input = new PassThrough();
        inputs.push(input);
        void runHostAttach({
          projectId: "p1",
          home,
          pollMs: 10,
          input,
          write: (line) => remote.send(JSON.parse(line)),
        });
        return undefined;
      },
    });
    const frames: { type: string; run?: { threadId: string; phase: string; result?: unknown } }[] = [];
    const open = () =>
      transport.channel(["rowbly", "host", "attach", "p1"], {
        onFrame: (frame) => void frames.push(frame as (typeof frames)[number]),
        onClose: () => undefined,
      });
    const release = { done: () => {} };
    const waiting = new Promise<void>((done) => {
      release.done = done;
    });
    const started = { count: 0 };
    worker.setResponses([
      async () => {
        started.count += 1;
        await waiting;
        return report;
      },
      fauxAssistantMessage("Done"),
    ]);
    await prepare();
    await writeSlotLimit(1, home);
    await open();
    startAgent();
    await submit("launch-1", "launch");
    await vi.waitFor(() => expect(frames.some((frame) => frame.run?.phase === "running")).toBe(true), {
      timeout: 30_000,
      interval: 20,
    });
    await vi.waitFor(() => expect(started.count).toBe(1), { timeout: 30_000, interval: 20 });

    transport.disconnect();
    inputs[0]?.end();
    release.done();
    const run = await ended();
    expect(run).toMatchObject({ endReason: "completed", result: { outcome: "complete" } });

    frames.splice(0);
    transport.reconnect();
    await open();
    await vi.waitFor(
      () =>
        expect(frames.find((frame) => frame.type === "run")?.run).toMatchObject({ result: { outcome: "complete" } }),
      { timeout: 10_000, interval: 20 },
    );
    inputs[1]?.end();
  }, 60_000);
});
