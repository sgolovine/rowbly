import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCliShim } from "../../commands/factory-runner/cli-shim.js";
import type { CheckProcess, CheckQueueDeps, ShellEnv } from "../check-queue/check-types.js";
import { type FactorySettingsInput, updateFactorySettings } from "../factory-settings/factory-settings.js";
import { loadPi } from "../pi-runtime/pi-runtime.js";
import { initProject } from "../project/project.js";
import { createStage } from "../stage/stage.js";
import { createStory } from "../story/story.js";
import { createFakeHostTransport } from "../test-project/fake-host-transport.js";
import { useTempDir } from "../test-project/test-project.js";
import type { ThreadRecord } from "../thread/thread.js";
import { buildThreadCopy } from "../thread-copy/thread-copy.js";
import { type HostAgentResult, runHostAgent } from "./host-agent.js";
import { readAgentState } from "./host-agent-claim.js";
import { submitHostCommand } from "./host-agent-control.js";
import { hostAgentPaths, prepareAgentDirs, threadPaths } from "./host-agent-paths.js";
import { prepareHostThread } from "./host-agent-prepare.js";
import type { HostWorkRunner } from "./host-agent-work.js";
import { runHostAttach } from "./host-attach.js";
import { readHostRun } from "./host-run-state.js";
import { createHostRunner } from "./host-runner.js";
import { writeSlotLimit } from "./host-slots.js";

const exec = promisify(execFile);
const git = (cwd: string, ...args: string[]) => exec("git", ["-C", cwd, ...args]);
const tool = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
const report = tool("report_result", { outcome: "complete", summary: "Done", blockers: [], problems: [] });
const CLONE = ".local/share/rowbly/projects/p1/repo";
const ONE_CHECK: FactorySettingsInput["checks"] = { maxConcurrent: 1, items: [{ key: "test", command: "pnpm test" }] };

/** Fake check processes. The test ends each process with `exit`. A signal ends it also. No real check starts. */
function fakeChecks() {
  const started: { command: string; cwd: string; env: ShellEnv; exit: (code: number | null) => void }[] = [];
  const signals: { pgid: number; signal: NodeJS.Signals }[] = [];
  const deps: CheckQueueDeps = {
    readMemAvailableMb: async () => 100_000,
    readGroupRssMb: async () => 10,
    readStartTicks: async () => "1",
    readHead: async () => "0123456789abcdef",
    spawn: (command, options) => {
      const end = { exit: (_code: number | null) => {} };
      const exited = new Promise<number | null>((done) => {
        end.exit = done;
      });
      started.push({ command, cwd: options.cwd, env: options.env, exit: (code) => end.exit(code) });
      return { pid: 4000 + started.length, exited, onOutput: () => undefined } satisfies CheckProcess;
    },
    kill: (pgid, signal) => {
      signals.push({ pgid, signal });
      started[pgid - 4001]?.exit(null);
    },
    now: Date.now,
    timing: { sampleMs: 10, admitMs: 20, progressMs: 10, killGraceMs: 20, minuteMs: 60_000 },
  };
  return { deps, started, signals };
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

describe("host runner checks", () => {
  const dir = useTempDir();
  const agents: { controller: AbortController; done: Promise<HostAgentResult> }[] = [];
  let home: string;
  let main: string;
  let clone: string;
  let storyId: string;
  let worker: ReturnType<typeof fauxProvider>;
  let runner: HostWorkRunner;
  let machine: ReturnType<typeof fakeChecks>;
  const paths = () => hostAgentPaths("p1", home);
  const worktree = () => `${clone}-worktrees/${storyId}`;
  const readJobs = async () => JSON.parse(await readFile(join(paths().runtime, "checks", "jobs.json"), "utf8")).jobs;

  beforeEach(async () => {
    home = join(dir.path, "home");
    main = join(dir.path, "main");
    const seed = join(dir.path, "seed");
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
    await writeFile(join(seed, "README.md"), "seed\n");
    await git(seed, "add", "README.md");
    await git(seed, "-c", "user.name=Test", "-c", "user.email=t@example.com", "commit", "-q", "-m", "seed");
    await exec("git", ["clone", "-q", "--bare", seed, join(dir.path, "origin.git")]);
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
    machine = fakeChecks();
    await writeSlotLimit(1, home);
  });

  afterEach(async () => {
    const running = agents.splice(0);
    for (const agent of running) agent.controller.abort();
    await Promise.all(running.map((agent) => agent.done));
    vi.unstubAllEnvs();
  });

  async function prepare(checks: FactorySettingsInput["checks"]) {
    if (checks) await updateFactorySettings({ checks }, { cwd: main });
    const copy = await buildThreadCopy({ storyId }, { cwd: main });
    const model = { provider: worker.getModel().provider, modelId: worker.getModel().id };
    await prepareHostThread(
      paths(),
      { threadId: "t1", thread: threadRecord("t1", storyId), storyId, clone: CLONE, model, message: "Work", copy },
      { home },
    );
  }

  function startAgent() {
    const controller = new AbortController();
    const done = runHostAgent({
      projectId: "p1",
      home,
      runner,
      pollMs: 10,
      signal: controller.signal,
      checkDeps: machine.deps,
    });
    agents.push({ controller, done });
  }

  async function submit(id: string, type: string) {
    await submitHostCommand(paths(), JSON.stringify({ version: 1, id, type, threadId: "t1" }));
  }

  async function ended() {
    return vi.waitFor(
      async () => {
        const run = await readHostRun(paths(), "t1");
        expect(run?.phase).toBe("ended");
        return run;
      },
      { timeout: 30_000, interval: 20 },
    );
  }

  async function session(file: string | undefined) {
    return readFile(join(paths().runtime, file as string), "utf8");
  }

  it("gates the check in bash, runs it through run_check on the host and records it in run.json", async () => {
    await prepare(ONE_CHECK);
    worker.setResponses([
      tool("bash", { command: "pnpm test --silent" }),
      tool("run_check", { check: "test" }),
      report,
      fauxAssistantMessage("Done"),
    ]);

    startAgent();
    await submit("launch-1", "launch");
    await vi.waitFor(() => expect(machine.started).toHaveLength(1), { timeout: 30_000, interval: 20 });
    machine.started[0]?.exit(0);
    const run = await ended();

    const copy = threadPaths(paths(), "t1").copy;
    expect(machine.started[0]).toMatchObject({ command: "pnpm test", cwd: worktree() });
    expect(machine.started[0]?.env).toMatchObject({
      ROWBLY_OUTBOX: paths().outbox,
      ROWBLY_THREAD_ID: "t1",
      ROWBLY_HOST_AGENT: paths().dir,
      ROWBLY_ROOT: copy,
      ROWBLY_CHECK: "1",
    });
    const owner = (await readAgentState(paths()))?.owner.token;
    expect(await readJobs()).toEqual([
      expect.objectContaining({ key: "test", status: "passed", ownerToken: owner, threadId: "t1", cwd: worktree() }),
    ]);
    expect(run).toMatchObject({ endReason: "completed", result: { outcome: "complete" } });
    expect(run?.checks).toEqual([
      expect.objectContaining({ key: "test", scope: "full", status: "passed", head: "0123456789abcdef" }),
    ]);
    const text = await session(run?.session?.file);
    expect(text).toContain("Run this check with run_check: test");
    expect(text).toContain("status: passed");
  }, 60_000);

  it("gives no run_check tool and no bash gate when the copy has no checks", async () => {
    await prepare(undefined);
    worker.setResponses([
      tool("run_check", { check: "test" }),
      tool("bash", { command: "echo pnpm test" }),
      report,
      fauxAssistantMessage("Done"),
    ]);

    startAgent();
    await submit("launch-1", "launch");
    const run = await ended();

    const text = await session(run?.session?.file);
    expect(run?.endReason).toBe("completed");
    expect(text).toContain("Tool run_check not found");
    expect(text).not.toContain("Run this check with run_check");
    expect(run?.checks).toBeUndefined();
    expect(machine.started).toHaveLength(0);
  }, 60_000);

  it.each([
    ["cancel-thread", "cancelled"],
    ["stop-thread", "stopped"],
  ])(
    "cancels the running check of the Thread after %s",
    async (type, reason) => {
      await prepare(ONE_CHECK);
      worker.setResponses([tool("run_check", { check: "test" }), fauxAssistantMessage("Done")]);

      startAgent();
      await submit("launch-1", "launch");
      await vi.waitFor(() => expect(machine.started).toHaveLength(1), { timeout: 30_000, interval: 20 });
      await submit("stop-1", type);
      const run = await ended();

      expect(machine.signals).toContainEqual({ pgid: 4001, signal: "SIGTERM" });
      expect(run?.endReason).toBe(reason);
      expect((await readJobs())[0].status).toBe("cancelled");
      await vi.waitFor(async () => expect((await readHostRun(paths(), "t1"))?.checks?.[0]?.status).toBe("cancelled"));
    },
    60_000,
  );

  it("continues a check when the channel stops, and a new channel gives the final check status", async () => {
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
    const frames: { type: string; run?: { checks?: { status: string }[] } }[] = [];
    const open = () =>
      transport.channel(["rowbly", "host", "attach", "p1"], {
        onFrame: (frame) => void frames.push(frame as (typeof frames)[number]),
        onClose: () => undefined,
      });
    await prepare(ONE_CHECK);
    worker.setResponses([tool("run_check", { check: "test" }), report, fauxAssistantMessage("Done")]);
    await open();
    startAgent();
    await submit("launch-1", "launch");
    await vi.waitFor(() => expect(frames.some((frame) => frame.run?.checks?.[0]?.status === "running")).toBe(true), {
      timeout: 30_000,
      interval: 20,
    });

    transport.disconnect();
    inputs[0]?.end();
    machine.started[0]?.exit(0);
    const run = await ended();
    expect(run?.checks?.[0]?.status).toBe("passed");

    frames.splice(0);
    transport.reconnect();
    await open();
    await vi.waitFor(
      () => expect(frames.find((frame) => frame.type === "run")?.run?.checks?.[0]?.status).toBe("passed"),
      { timeout: 10_000, interval: 20 },
    );
    inputs[1]?.end();
  }, 60_000);
});
