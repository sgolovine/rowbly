import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
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
import { createCliShim } from "../../commands/factory-runner/factory-runner.js";
import type { CheckProcess, CheckQueueDeps } from "../check-queue/check-types.js";
import { updateFactorySettings } from "../factory-settings/factory-settings.js";
import { updateFactoryState } from "../factory-state/factory-state.js";
import { loadPi } from "../pi-runtime/pi-runtime.js";
import { initProject } from "../project/project.js";
import { createStage } from "../stage/stage.js";
import { createStory } from "../story/story.js";
import { promptHash } from "../supervisor-digest/supervisor-digest.js";
import { useTempDir } from "../test-project/test-project.js";
import { listThreads } from "../thread/thread.js";
import { createFactoryManager, type FactoryManager } from "./factory-manager.js";
import { checkHistory } from "./worker-checks.js";

const exec = promisify(execFile);
const PROMPT = "Move this Story to Done. Report complete.";
const tool = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });

/** Fake check processes. The test ends each process with `exit`. */
function fakeChecks() {
  const started: { command: string; exit: (code: number | null) => void; output: (text: string) => void }[] = [];
  const deps: CheckQueueDeps = {
    readMemAvailableMb: async () => 100_000,
    readGroupRssMb: async () => 10,
    readStartTicks: async () => "1",
    readHead: async () => "0123456789abcdef",
    spawn: (command) => {
      const listeners: ((chunk: string) => void)[] = [];
      let end: (code: number | null) => void = () => {};
      const exited = new Promise<number | null>((r) => {
        end = r;
      });
      started.push({
        command,
        exit: end,
        output: (text) => {
          for (const listener of listeners) listener(text);
        },
      });
      return { pid: 4000 + started.length, exited, onOutput: (l) => listeners.push(l) } satisfies CheckProcess;
    },
    kill: (pgid) => started[pgid - 4001]?.exit(null),
    now: Date.now,
    timing: { sampleMs: 10, admitMs: 20, progressMs: 10, killGraceMs: 20, minuteMs: 60_000 },
  };
  return { deps, started };
}

describe("factory checks", () => {
  const dir = useTempDir();
  let manager: FactoryManager | undefined;
  let root: string;

  beforeEach(async () => {
    root = join(dir.path, "project");
    await mkdir(root);
    vi.stubEnv("HOME", join(dir.path, "home"));
    vi.stubEnv("PI_CODING_AGENT_DIR", join(dir.path, "agent"));
    vi.stubEnv("PI_OFFLINE", "1");
    await initProject({ name: "Test", key: "TST" }, { cwd: root });
    await createStage({ label: "Work", key: "WORK", prompt: PROMPT }, { cwd: root });
    await exec("git", ["init", root]);
    await exec("git", ["-C", root, "add", ".rowbly"]);
    await exec("git", ["-C", root, "-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-m", "initial"]);
  });

  afterEach(async () => {
    await manager?.shutdown();
    manager = undefined;
    vi.unstubAllEnvs();
  });

  async function fixture(checks: Parameters<typeof updateFactorySettings>[0]["checks"]) {
    const sdk = await loadPi();
    const runtime = await sdk.ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    const supervisor = fauxProvider({ provider: "supervisor", api: "supervisor-faux" });
    const worker = fauxProvider({ provider: "worker", api: "worker-faux" });
    runtime.registerNativeProvider(supervisor.provider);
    runtime.registerNativeProvider(worker.provider);
    await updateFactorySettings(
      {
        maxWorkers: 1,
        supervisorModel: { provider: "supervisor", modelId: supervisor.getModel().id },
        workerModel: { provider: "worker", modelId: worker.getModel().id },
        ...(checks ? { checks } : {}),
      },
      { cwd: root },
    );
    await updateFactoryState(root, (state) => ({
      ...state,
      prompts: { WORK: { hash: promptHash(PROMPT), class: "work" } },
    }));
    const shim = await createCliShim(
      {
        executable: process.execPath,
        execArgv: ["--import", resolve("node_modules/tsx/dist/loader.mjs")],
        entry: resolve("src/cli.ts"),
      },
      { cwd: root },
    );
    const machine = fakeChecks();
    manager = await createFactoryManager(
      { runtime, agentDir: join(dir.path, "agent"), shim, checkDeps: machine.deps },
      { cwd: root },
    );
    return { supervisor, worker, manager, machine };
  }

  async function settledWorker() {
    await vi.waitFor(
      async () => {
        const [worker] = (await listThreads({ role: "worker" }, { cwd: root })).threads;
        expect(["completed", "failed", "interrupted", "cancelled"]).toContain(worker?.status);
      },
      { timeout: 15_000, interval: 20 },
    );
    return (await listThreads({ role: "worker" }, { cwd: root })).threads[0];
  }

  it("gates the check in bash, runs it through run_check, and records it for the Thread and the digest", async () => {
    const story = await createStory({ title: "Check me", stage: "WORK" }, { cwd: root });
    const f = await fixture({
      maxConcurrent: 1,
      items: [{ key: "test", label: "Tests", command: "pnpm test", narrowCommand: "pnpm vitest {files}" }],
    });
    const digests: string[] = [];
    const remember: FauxResponseStep = (context) => {
      digests.push(JSON.stringify(context.messages));
      return fauxAssistantMessage("Wait");
    };
    f.supervisor.setResponses([
      tool("start_worker", { storyId: story.id, stage: "WORK", requestId: "one" }),
      remember,
      remember,
      remember,
    ]);
    f.worker.setResponses([
      (context) => {
        digests.push(`worker:${JSON.stringify(context.messages)}`);
        return tool("bash", { command: "pnpm test --silent" });
      },
      tool("run_check", { check: "test", files: ["src/a.ts"] }),
      tool("bash", { command: `rowbly -C "$ROWBLY_ROOT" --json story update ${story.id} --stage DONE` }),
      tool("report_result", { outcome: "complete", summary: "Checked", blockers: [], problems: [] }),
      fauxAssistantMessage("Done"),
    ]);

    const run = f.manager.run();
    try {
      await vi.waitFor(() => expect(f.machine.started).toHaveLength(1), { timeout: 10_000 });
      expect(f.machine.started[0]?.command).toBe("pnpm vitest 'src/a.ts'");
      const status = JSON.parse(await readFile(join(root, ".rowbly/runtime/status.json"), "utf8"));
      await vi.waitFor(async () => {
        const current = JSON.parse(await readFile(join(root, ".rowbly/runtime/status.json"), "utf8"));
        expect(current.checks).toMatchObject({ running: 1, queued: 0, maxConcurrent: 1 });
      });
      expect(status.checks).toBeDefined();
      f.machine.started[0]?.output("1 failed\n");
      f.machine.started[0]?.exit(1);

      const worker = await settledWorker();

      expect(worker?.status).toBe("completed");
      expect(worker?.checks).toEqual([
        expect.objectContaining({ key: "test", scope: "narrow", status: "failed", head: "0123456789abcdef" }),
      ]);
      const session = await readFile(join(root, ".rowbly/runtime", worker?.session.file as string), "utf8");
      expect(session).toContain("Run this check with run_check: test");
      expect(session).toContain("status: failed\\nexitCode: 1");
      expect(session).toContain("1 failed");
      expect(f.machine.started).toHaveLength(1);
      expect(digests.find((text) => text.startsWith("worker:"))).toContain("run_check");
      const jobs = JSON.parse(await readFile(join(root, ".rowbly/runtime/checks/jobs.json"), "utf8")).jobs;
      expect(jobs).toEqual([expect.objectContaining({ key: "test", status: "failed", threadId: worker?.id })]);
      expect(await readFile(join(root, `.rowbly/runtime/checks/${jobs[0].id}.log`), "utf8")).toBe("1 failed\n");
      await vi.waitFor(
        () => {
          const digest = digests.filter((text) => !text.startsWith("worker:")).at(-1) ?? "";
          expect(digest).toContain("checks");
          expect(digest).toContain("0123456789ab");
        },
        { timeout: 10_000 },
      );
    } finally {
      await f.manager.shutdown();
      await run;
    }
  });

  it("works as before without a checks section: no run_check tool and no bash gate", async () => {
    const story = await createStory({ title: "Plain", stage: "WORK" }, { cwd: root });
    const f = await fixture(undefined);
    const prompts: string[] = [];
    f.supervisor.setResponses([
      tool("start_worker", { storyId: story.id, stage: "WORK", requestId: "one" }),
      fauxAssistantMessage("Wait"),
      fauxAssistantMessage("Done"),
    ]);
    f.worker.setResponses([
      (context) => {
        prompts.push(JSON.stringify(context.messages));
        return tool("run_check", { check: "test" });
      },
      tool("bash", { command: "echo pnpm test" }),
      tool("bash", { command: `rowbly -C "$ROWBLY_ROOT" --json story update ${story.id} --stage DONE` }),
      tool("report_result", { outcome: "complete", summary: "Plain", blockers: [], problems: [] }),
      fauxAssistantMessage("Done"),
    ]);

    const run = f.manager.run();
    try {
      const worker = await settledWorker();
      const session = await readFile(join(root, ".rowbly/runtime", worker?.session.file as string), "utf8");
      const status = JSON.parse(await readFile(join(root, ".rowbly/runtime/status.json"), "utf8"));

      expect(worker?.status).toBe("completed");
      expect(worker?.checks).toBeUndefined();
      expect(session).toMatch(/Tool run_check not found|run_check/);
      expect(session).not.toContain("Run this check with run_check");
      expect(session).toContain("pnpm test\\n");
      expect(prompts[0]).not.toContain("Run each listed check");
      expect(status.checks).toBeUndefined();
      expect(f.machine.started).toHaveLength(0);
    } finally {
      await f.manager.shutdown();
      await run;
    }
  });

  it("cancels the running check of a cancelled worker", async () => {
    const story = await createStory({ title: "Cancel me", stage: "WORK" }, { cwd: root });
    const f = await fixture({ items: [{ key: "test", command: "pnpm test" }] });
    f.supervisor.setResponses([
      tool("start_worker", { storyId: story.id, stage: "WORK", requestId: "one" }),
      fauxAssistantMessage("Wait"),
      fauxAssistantMessage("Wait"),
    ]);
    f.worker.setResponses([tool("run_check", { check: "test" }), fauxAssistantMessage("Done")]);

    const run = f.manager.run();
    try {
      await vi.waitFor(() => expect(f.machine.started).toHaveLength(1), { timeout: 10_000 });
      const [thread] = (await listThreads({ role: "worker" }, { cwd: root })).threads;
      await f.manager.cancelWorker(thread?.id as string, thread?.runs.at(-1)?.id as string);

      const worker = await settledWorker();

      expect(worker?.status).toBe("cancelled");
      await vi.waitFor(async () => {
        const jobs = JSON.parse(await readFile(join(root, ".rowbly/runtime/checks/jobs.json"), "utf8")).jobs;
        expect(jobs[0].status).toBe("cancelled");
      });
    } finally {
      await f.manager.shutdown();
      await run;
    }
  });
});

describe("checkHistory", () => {
  it("gives the last full and narrow result and the commit of each check key", () => {
    expect(
      checkHistory([
        { id: "1", key: "test", scope: "full", status: "failed", head: "aaaaaaaaaaaaaaaa" },
        { id: "2", key: "test", scope: "narrow", status: "passed", head: "bbbbbbbbbbbbbbbb" },
        { id: "3", key: "test", scope: "full", status: "passed", head: "cccccccccccccccc" },
        { id: "4", key: "lint", scope: "full", status: "running" },
      ]),
    ).toEqual([
      {
        key: "test",
        full: { status: "passed", head: "cccccccccccc" },
        narrow: { status: "passed", head: "bbbbbbbbbbbb" },
      },
      { key: "lint", full: { status: "running" }, narrow: undefined },
    ]);
  });
});
