import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { type CheckOutcome, submitCheck } from "../check-queue/check-queue.js";
import type { CheckProcess, CheckQueueDeps, ShellEnv } from "../check-queue/check-types.js";
import { useTempDir } from "../test-project/test-project.js";
import { runHostAgent } from "./host-agent.js";
import { readAgentState } from "./host-agent-claim.js";
import { submitHostCommand } from "./host-agent-control.js";
import { hostAgentPaths } from "./host-agent-paths.js";
import type { HostLaunchRequest, HostWorkRunner } from "./host-agent-work.js";
import { bindHostRun, hostCheckPaths } from "./host-checks.js";
import { writeSlotLimit } from "./host-slots.js";

/** Fake check processes. A signal ends the process. No real check starts. */
function fakeChecks(startTicks: (pid: number) => string | undefined = () => "1") {
  const started: { command: string; env: ShellEnv; exit: (code: number | null) => void }[] = [];
  const signals: { pgid: number; signal: NodeJS.Signals }[] = [];
  const deps: CheckQueueDeps = {
    readMemAvailableMb: async () => 100_000,
    readGroupRssMb: async () => 10,
    readStartTicks: async (pid) => startTicks(pid),
    readHead: async () => "0123456789abcdef",
    spawn: (command, options) => {
      const end = { exit: (_code: number | null) => {} };
      const exited = new Promise<number | null>((resolve) => {
        end.exit = resolve;
      });
      started.push({ command, env: options.env, exit: (code) => end.exit(code) });
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

function request(threadId: string, key: string) {
  return {
    threadId,
    storyId: "ROW-1",
    stage: "WORK",
    rank: 0,
    key,
    scope: "full" as const,
    files: [],
    command: `run ${key}`,
    cwd: "/work",
    env: {},
    memoryMb: 10,
    timeoutMinutes: 5,
  };
}

describe("host checks", () => {
  const home = useTempDir();
  const paths = () => hostAgentPaths("p1", home.path);
  const jobsFile = () => join(paths().runtime, "checks", "jobs.json");
  const readJobs = async () => JSON.parse(await readFile(jobsFile(), "utf8")).jobs;

  it("keeps the records below the runtime folder of the agent", () => {
    expect(hostCheckPaths(paths())).toMatchObject({ dir: paths().dir, runtimeDir: paths().runtime });
  });

  it.each([
    ["the recorded start ticks", "77", 1],
    ["different start ticks", "78", 0],
  ])("stops the check group of a dead agent at start only with %s", async (_name, ticks, signalled) => {
    await mkdir(join(paths().runtime, "checks"), { recursive: true });
    const orphan = {
      ...request("t1", "test"),
      id: "old-job",
      ownerToken: "dead-owner",
      seq: 1,
      status: "running",
      queuedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      pgid: 5000,
      startTicks: "77",
    };
    await writeFile(jobsFile(), JSON.stringify({ version: 1, jobs: [orphan] }));
    const alive = { value: true };
    const machine = fakeChecks((pid) => (pid === 5000 && alive.value ? ticks : undefined));
    const deps = {
      ...machine.deps,
      kill: (pgid: number, signal: NodeJS.Signals) => {
        machine.signals.push({ pgid, signal });
        alive.value = false;
      },
    };
    const controller = new AbortController();
    controller.abort();

    await runHostAgent({ projectId: "p1", home: home.path, pollMs: 10, signal: controller.signal, checkDeps: deps });

    expect(machine.signals).toEqual(signalled ? [{ pgid: 5000, signal: "SIGTERM" }] : []);
    expect(await readJobs()).toEqual([expect.objectContaining({ id: "old-job", status: "cancelled" })]);
  });

  it("cancels the queued checks and signals each running group when the agent stops", async () => {
    const machine = fakeChecks();
    const outcomes: Promise<CheckOutcome>[] = [];
    const ends: (() => void)[] = [];
    const runner: HostWorkRunner = {
      start: async (launch: HostLaunchRequest) => {
        const checks = launch.checks;
        if (!checks) throw new Error("No check queue");
        bindHostRun(checks, {
          threadId: launch.threadId,
          settings: { checks: { maxConcurrent: 1 } } as never,
          receiver: () => undefined,
        });
        outcomes.push(submitCheck(checks.queue, request(launch.threadId, "first")));
        outcomes.push(submitCheck(checks.queue, request(launch.threadId, "second")));
        const ended = new Promise<void>((resolve) => ends.push(resolve));
        return {
          ended,
          stop: async () => {
            for (const end of ends) end();
          },
        };
      },
    };
    await writeSlotLimit(1, home.path);
    const controller = new AbortController();
    const done = runHostAgent({
      projectId: "p1",
      home: home.path,
      pollMs: 10,
      runner,
      signal: controller.signal,
      checkDeps: machine.deps,
    });
    await submitHostCommand(paths(), JSON.stringify({ version: 1, id: "l1", type: "launch", threadId: "t1" }));
    await vi.waitFor(() => expect(machine.started).toHaveLength(1), { timeout: 10_000, interval: 10 });

    controller.abort();
    const result = await done;

    expect(machine.signals).toContainEqual({ pgid: 4001, signal: "SIGTERM" });
    const jobs = await readJobs();
    expect(jobs.map((job: { key: string; status: string }) => [job.key, job.status])).toEqual([
      ["first", "cancelled"],
      ["second", "cancelled"],
    ]);
    expect(jobs.every((job: { ownerToken: string }) => job.ownerToken === result.owner.token)).toBe(true);
    expect(machine.started).toHaveLength(1);
    expect((await Promise.all(outcomes)).map((outcome) => outcome.job.status)).toEqual(["cancelled", "cancelled"]);
    expect((await readAgentState(paths()))?.phase).toBe("stopped");
  });
});
