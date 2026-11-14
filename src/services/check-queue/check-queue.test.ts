import { readFile, stat } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckLimits } from "../factory-settings/check-settings.js";
import { prepareRuntime } from "../runtime-files/runtime-files.js";
import { useTestProject } from "../test-project/test-project.js";
import { estimateMb, formatDuration, outputTail, progressText, waitingJobs } from "./check-order.js";
import { stopOrphanChecks } from "./check-orphans.js";
import {
  type CheckJob,
  type CheckQueue,
  type CheckRequest,
  cancelThreadChecks,
  checkQueueStatus,
  createCheckQueue,
  stopCheckQueue,
  submitCheck,
} from "./check-queue.js";
import { KEPT_JOBS, keptJobs, readCheckJobs, writeCheckJobs } from "./check-records.js";
import type { CheckProcess, CheckQueueDeps } from "./check-types.js";

interface FakeProcess {
  readonly pid: number;
  readonly command: string;
  readonly env: Record<string, string | undefined>;
  readonly exit: (code: number | null) => void;
  readonly output: (text: string) => void;
}

/** A machine with fake memory, fake processes and fake signals. A signal ends a process unless it ignores SIGTERM. */
function fakeMachine() {
  const processes: FakeProcess[] = [];
  const signals: [number, string][] = [];
  const ignoreTerm = new Set<number>();
  const memory = { availableMb: 100_000, rssMb: 0 };
  const exited = new Set<number>();
  const deps: CheckQueueDeps = {
    readMemAvailableMb: async () => memory.availableMb,
    readGroupRssMb: async () => memory.rssMb,
    readStartTicks: async (pid) => (exited.has(pid) ? undefined : `ticks-${pid}`),
    readHead: async () => "abc123",
    spawn: (command, options) => {
      const pid = 1000 + processes.length;
      const listeners: ((chunk: string) => void)[] = [];
      let resolve: (code: number | null) => void = () => {};
      const done = new Promise<number | null>((r) => {
        resolve = r;
      });
      const process: CheckProcess = { pid, exited: done, onOutput: (listener) => listeners.push(listener) };
      processes.push({
        pid,
        command,
        env: { ...options.env },
        exit: (code) => {
          exited.add(pid);
          resolve(code);
        },
        output: (text) => {
          for (const listener of listeners) listener(text);
        },
      });
      return process;
    },
    kill: (pgid, signal) => {
      signals.push([pgid, signal]);
      if (signal === "SIGKILL" || !ignoreTerm.has(pgid)) processes.find((p) => p.pid === pgid)?.exit(null);
    },
    now: Date.now,
    timing: { sampleMs: 5, admitMs: 10, progressMs: 5, killGraceMs: 20, minuteMs: 30 },
  };
  return { deps, processes, signals, memory, ignoreTerm, exited };
}

function request(changes: Partial<CheckRequest> = {}): CheckRequest {
  return {
    threadId: "t1",
    storyId: "TST-1",
    stage: "WORK",
    rank: 1,
    key: "test",
    scope: "full",
    files: [],
    command: "pnpm test",
    cwd: "/tmp",
    env: { PATH: "/bin" },
    memoryMb: 1000,
    timeoutMinutes: 30,
    ...changes,
  };
}

describe("check queue", () => {
  const project = useTestProject();
  let machine: ReturnType<typeof fakeMachine>;
  let limits: CheckLimits;
  let changes: CheckJob[];

  beforeEach(async () => {
    await prepareRuntime(project.paths);
    machine = fakeMachine();
    limits = { maxConcurrent: 2, reserveMemoryMb: 2048, items: [] };
    changes = [];
  });

  function open(): Promise<CheckQueue> {
    return createCheckQueue({
      paths: project.paths,
      ownerToken: "owner",
      deps: machine.deps,
      limits: () => limits,
      onChange: (job) => changes.push(job),
    });
  }

  it("runs at most maxConcurrent checks, and the others wait with queued progress", async () => {
    const queue = await open();
    const progress: string[][] = [[], [], [], []];
    const results = [0, 1, 2, 3].map((i) =>
      submitCheck(queue, request({ threadId: `t${i}` }), { onProgress: (text) => progress[i]?.push(text) }),
    );

    await vi.waitFor(() => expect(machine.processes).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(machine.processes).toHaveLength(2);
    expect(checkQueueStatus(queue)).toMatchObject({ running: 2, queued: 2, maxConcurrent: 2 });
    expect(progress[3]).toContain("queued, position 2");
    expect(machine.processes[0]?.env).toMatchObject({ PATH: "/bin", ROWBLY_CHECK: "1" });

    machine.processes[0]?.exit(0);
    await vi.waitFor(() => expect(machine.processes).toHaveLength(3));
    machine.processes[1]?.exit(0);
    await vi.waitFor(() => expect(machine.processes).toHaveLength(4));
    machine.processes[2]?.exit(0);
    machine.processes[3]?.exit(1);

    const outcomes = await Promise.all(results);

    expect(outcomes.map((o) => o.job.status)).toEqual(["passed", "passed", "passed", "failed"]);
    expect(progress[0]?.some((text) => text.startsWith("running, "))).toBe(true);
    await stopCheckQueue(queue);
  });

  it("holds a job while memory is short and a job runs, and starts it when memory is free or no job runs", async () => {
    const queue = await open();
    machine.memory.availableMb = 2048 + 1500;
    const first = submitCheck(queue, request({ memoryMb: 1000 }));
    await vi.waitFor(() => expect(machine.processes).toHaveLength(1));

    machine.memory.availableMb = 2048 + 500;
    const second = submitCheck(queue, request({ memoryMb: 1000, threadId: "t2" }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(machine.processes).toHaveLength(1);
    expect(checkQueueStatus(queue).availableMb).toBe(2548);

    machine.processes[0]?.exit(0);
    await first;
    await vi.waitFor(() => expect(machine.processes).toHaveLength(2));

    const third = submitCheck(queue, request({ memoryMb: 1000, threadId: "t3" }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(machine.processes).toHaveLength(2);
    machine.memory.availableMb = 10_000;
    await vi.waitFor(() => expect(machine.processes).toHaveLength(3));

    machine.processes[1]?.exit(0);
    machine.processes[2]?.exit(0);
    await Promise.all([second, third]);
    await stopCheckQueue(queue);
  });

  it("starts the jobs nearest to the last Stage first, then by arrival", async () => {
    limits = { ...limits, maxConcurrent: 1 };
    const queue = await open();
    const blocker = submitCheck(queue, request({ command: "first" }));
    await vi.waitFor(() => expect(machine.processes).toHaveLength(1));
    const early = submitCheck(queue, request({ rank: 1, command: "early" }));
    const late = submitCheck(queue, request({ rank: 3, command: "late" }));
    const later = submitCheck(queue, request({ rank: 1, command: "later" }));

    for (const index of [0, 1, 2, 3]) {
      await vi.waitFor(() => expect(machine.processes.length).toBeGreaterThan(index));
      machine.processes[index]?.exit(0);
    }

    await Promise.all([blocker, early, late, later]);
    expect(machine.processes.map((p) => p.command)).toEqual(["first", "late", "early", "later"]);
    await stopCheckQueue(queue);
  });

  it("gives the exit code, the last output and a log path that exists for a failed check", async () => {
    const queue = await open();
    const result = submitCheck(queue, request());
    await vi.waitFor(() => expect(machine.processes).toHaveLength(1));
    machine.memory.rssMb = 700;
    await new Promise((resolve) => setTimeout(resolve, 20));
    machine.processes[0]?.output("line 1\nFAIL test.ts\n");
    machine.processes[0]?.exit(2);

    const outcome = await result;

    expect(outcome.job).toMatchObject({ status: "failed", exitCode: 2, head: "abc123", peakMb: 700, pgid: 1000 });
    expect(outcome.job.startTicks).toBe("ticks-1000");
    expect(outcome.output).toBe("line 1\nFAIL test.ts");
    expect(await readFile(outcome.log, "utf8")).toBe("line 1\nFAIL test.ts\n");
    expect((await stat(outcome.log)).mode & 0o777).toBe(0o600);
    await stopCheckQueue(queue);
    expect((await readCheckJobs(project.paths)).at(-1)).toMatchObject({ status: "failed", exitCode: 2 });
  });

  it("stops a check after its timeout with SIGTERM, then SIGKILL", async () => {
    const queue = await open();
    machine.ignoreTerm.add(1000);
    const outcome = await submitCheck(queue, request({ timeoutMinutes: 1 }));

    expect(outcome.job.status).toBe("timed_out");
    expect(machine.signals).toEqual([
      [1000, "SIGTERM"],
      [1000, "SIGKILL"],
    ]);
    await stopCheckQueue(queue);
  });

  it("cancels the queued and running jobs of one Thread, and an aborted signal cancels its job", async () => {
    limits = { ...limits, maxConcurrent: 1 };
    const queue = await open();
    const running = submitCheck(queue, request());
    await vi.waitFor(() => expect(machine.processes).toHaveLength(1));
    const queued = submitCheck(queue, request());
    const controller = new AbortController();
    const other = submitCheck(queue, request({ threadId: "t2" }), { signal: controller.signal });

    await cancelThreadChecks(queue, "t1");

    expect((await running).job.status).toBe("cancelled");
    expect((await queued).job.status).toBe("cancelled");
    await vi.waitFor(() => expect(machine.processes).toHaveLength(2));
    controller.abort();
    expect((await other).job.status).toBe("cancelled");
    expect(machine.signals.map(([pgid]) => pgid)).toEqual([1000, 1001]);
    await stopCheckQueue(queue);
  });

  it("stops each running group and cancels the queued jobs at stop, then refuses new jobs", async () => {
    limits = { ...limits, maxConcurrent: 1 };
    const queue = await open();
    const running = submitCheck(queue, request());
    await vi.waitFor(() => expect(machine.processes).toHaveLength(1));
    const queued = submitCheck(queue, request());

    await stopCheckQueue(queue);

    expect((await running).job.status).toBe("cancelled");
    expect((await queued).job.status).toBe("cancelled");
    expect(machine.exited.has(1000)).toBe(true);
    expect(machine.processes).toHaveLength(1);
    await expect(submitCheck(queue, request())).rejects.toThrow("stopping");
    expect(changes.map((job) => job.status)).toContain("cancelled");
  });

  it("loads the earlier records, so that the estimate uses the peak of the earlier runs", async () => {
    const first = await open();
    const result = submitCheck(first, request());
    await vi.waitFor(() => expect(machine.processes).toHaveLength(1));
    machine.memory.rssMb = 3000;
    await new Promise((resolve) => setTimeout(resolve, 20));
    machine.processes[0]?.exit(0);
    await result;
    await stopCheckQueue(first);

    const second = await open();
    const job = { ...(await readCheckJobs(project.paths))[0], status: "queued" } as CheckJob;

    expect(estimateMb((await readCheckJobs(project.paths)) as CheckJob[], job)).toBe(3000);
    await stopCheckQueue(second);
  });
});

describe("check records and order", () => {
  const project = useTestProject();

  it("keeps the last 500 final jobs and all active jobs", () => {
    const jobs = Array.from({ length: KEPT_JOBS + 5 }, (_, i) => ({ id: `j${i}`, status: "passed" }) as CheckJob);
    const active = { id: "active", status: "running" } as CheckJob;
    const kept = keptJobs([active, ...jobs]);

    expect(kept).toHaveLength(KEPT_JOBS);
    expect(kept[0]?.id).toBe("active");
    expect(kept.at(-1)?.id).toBe(`j${KEPT_JOBS + 4}`);
  });

  it("gives the tail of the output, the duration and the position", () => {
    const lines = Array.from({ length: 250 }, (_, i) => `l${i}`).join("\n");

    expect(outputTail(lines).split("\n")).toHaveLength(200);
    expect(outputTail("x".repeat(30_000))).toHaveLength(20_000);
    expect(formatDuration(100_000)).toBe("1m40s");
    expect(formatDuration(5_000)).toBe("5s");

    const jobs = [
      { id: "a", status: "queued", rank: 1, seq: 1 },
      { id: "b", status: "queued", rank: 2, seq: 2 },
    ] as CheckJob[];

    expect(waitingJobs(jobs).map((job) => job.id)).toEqual(["b", "a"]);
    expect(progressText(jobs, "a", 0)).toBe("queued, position 2");
  });

  it("stops the orphan groups of a dead owner whose leader has the recorded start ticks", async () => {
    await prepareRuntime(project.paths);
    const machine = fakeMachine();
    const base = { ownerToken: "dead", key: "test", scope: "full", queuedAt: new Date().toISOString() };
    const jobs = [
      { ...base, id: "live", status: "running", pgid: 1000, startTicks: "ticks-1000" },
      { ...base, id: "reused", status: "running", pgid: 1001, startTicks: "other" },
      { ...base, id: "queued", status: "queued" },
      { ...base, id: "mine", status: "running", ownerToken: "new", pgid: 1002, startTicks: "ticks-1002" },
    ] as CheckJob[];
    machine.deps.spawn("sleep", { cwd: "/tmp", env: {} });
    await writeCheckJobs(project.paths, jobs, []);

    expect(await stopOrphanChecks(project.paths, "new", machine.deps)).toBe(3);

    expect(machine.signals).toEqual([[1000, "SIGTERM"]]);
    expect((await readCheckJobs(project.paths)).map((job) => job.status)).toEqual([
      "cancelled",
      "cancelled",
      "cancelled",
      "running",
    ]);
  });
});
