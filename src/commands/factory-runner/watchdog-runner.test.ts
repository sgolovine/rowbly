import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getFactoryStatus } from "../../services/factory/factory.js";
import {
  acquireFactoryOwnership,
  newOwner,
  releaseFactoryOwnership,
} from "../../services/factory-ownership/factory-ownership.js";
import {
  acquireWatchdogClaim,
  readWatchdogClaim,
  readWatchdogState,
  type WatchdogTiming,
  writeWatchdogState,
} from "../../services/factory-watchdog/factory-watchdog.js";
import { useTestProject } from "../../services/test-project/test-project.js";
import { runWatchdog, type WatchdogInput } from "./watchdog-runner.js";

/** One run of the fake daemon: wait, then exit with a code or kill itself with a signal. */
interface Step {
  sleepMs?: number;
  code?: number;
  signal?: NodeJS.Signals;
}

const timing: WatchdogTiming = { backoffMs: [10, 20, 30, 40, 50], crashLimit: 5, stableMs: 60_000 };

describe("factory watchdog", () => {
  const project = useTestProject();

  /** Writes a fake daemon entry. Each start appends a line to `starts`, then runs the step of its index. */
  async function fakeDaemon(
    steps: Step[],
  ): Promise<{ launch: WatchdogInput["launch"]; starts: () => Promise<number> }> {
    const dir = project.paths.root;
    const counter = join(dir, "starts.txt");
    const entry = join(dir, "fake-daemon.mjs");
    await writeFile(counter, "");
    await writeFile(
      entry,
      `import { appendFileSync, readFileSync } from "node:fs";
      appendFileSync(${JSON.stringify(counter)}, "x\\n");
      const index = readFileSync(${JSON.stringify(counter)}, "utf8").trim().split("\\n").length - 1;
      const step = ${JSON.stringify(steps)}[index] ?? { code: 0 };
      console.error("fake daemon run " + index);
      setTimeout(() => step.signal ? process.kill(process.pid, step.signal) : process.exit(step.code ?? 0), step.sleepMs ?? 0);
      `,
    );
    return {
      launch: { executable: process.execPath, execArgv: [], entry },
      starts: async () => (await readFile(counter, "utf8")).split("\n").filter(Boolean).length,
    };
  }

  it("restarts a crashed daemon after the back-off and stops after a clean exit", async () => {
    const fake = await fakeDaemon([{ code: 3 }, { code: 0 }]);
    const result = await runWatchdog({ launch: fake.launch, timing }, project.ctx);
    expect(result).toMatchObject({ phase: "stopped", crashCount: 1 });
    expect(await fake.starts()).toBe(2);
    const state = await readWatchdogState(project.paths);
    expect(state).toMatchObject({ phase: "stopped", crashCount: 1, lastExit: "code 3" });
    expect(Date.parse(state?.lastCrashAt ?? "")).toBeGreaterThan(0);
    const status = await getFactoryStatus(project.ctx);
    expect(status).toMatchObject({ phase: "stopped", restarts: 1, lastCrashAt: state?.lastCrashAt });
  });

  it("starts with a count of 0 after the failed phase, and keeps the time of the last crash", async () => {
    const self = await newOwner();
    const lastCrashAt = new Date(Date.now() - 60_000).toISOString();
    await writeWatchdogState(project.paths, {
      version: 1,
      pid: self.pid,
      process: { ...self, token: "old", processIdentity: "gone" },
      phase: "failed",
      crashCount: 5,
      lastCrashAt,
      lastExit: "code 1",
      updatedAt: lastCrashAt,
    });
    const fake = await fakeDaemon([{ code: 0 }]);
    expect(await runWatchdog({ launch: fake.launch, timing }, project.ctx)).toMatchObject({ crashCount: 0 });
    expect(await readWatchdogState(project.paths)).toMatchObject({ phase: "stopped", crashCount: 0, lastCrashAt });
    expect(await getFactoryStatus(project.ctx)).toMatchObject({ phase: "stopped", restarts: 0, lastCrashAt });
  });

  it("does not restart after a clean exit", async () => {
    const fake = await fakeDaemon([{ code: 0 }]);
    expect(await runWatchdog({ launch: fake.launch, timing }, project.ctx)).toMatchObject({
      phase: "stopped",
      crashCount: 0,
    });
    expect(await fake.starts()).toBe(1);
  });

  it("stays stopped after 5 crashes in a row, with the last exit and the log in an attention entry", async () => {
    const fake = await fakeDaemon([{ code: 1 }, { code: 2 }, { code: 1 }, { code: 1 }, { signal: "SIGKILL" }]);
    const result = await runWatchdog({ launch: fake.launch, timing }, project.ctx);
    expect(result).toMatchObject({ phase: "failed", crashCount: 5 });
    expect(await fake.starts()).toBe(5);
    const state = await readWatchdogState(project.paths);
    expect(state).toMatchObject({ phase: "failed", crashCount: 5, lastExit: "signal SIGKILL" });
    expect(await stat(state?.lastLog ?? "")).toBeTruthy();
    expect(await readFile(state?.lastLog ?? "", "utf8")).toContain("fake daemon run 4");
    const status = await getFactoryStatus(project.ctx);
    expect(status.phase).toBe("failed");
    expect(status.restarts).toBe(5);
    const [entry] = status.attention as [string, { text: string }][];
    expect(entry?.[0]).toBe("watchdog:crash-limit");
    expect(entry?.[1].text).toContain("signal SIGKILL");
    expect(entry?.[1].text).toContain(state?.lastLog);
  });

  it("sets the count to 0 when a daemon stays up for the stable period", async () => {
    // The stable timer starts at the spawn, and each crash step sleeps for longer than the stable period
    // after Node starts. Thus each crashed daemon was up for longer than the stable period.
    const steps = Array.from({ length: 6 }, () => ({ sleepMs: 400, code: 1 }));
    const fake = await fakeDaemon([...steps, { code: 0 }]);
    const short = { ...timing, stableMs: 200 };
    const result = await runWatchdog({ launch: fake.launch, timing: short }, project.ctx);
    // Six crashes, more than the limit, but the count did not reach the limit. The last daemon exits
    // cleanly. Its start time on a slow machine can be longer than the stable period, so the final
    // count is 0 or 1.
    expect(result.phase).toBe("stopped");
    expect(result.crashCount).toBeLessThanOrEqual(1);
    expect(await fake.starts()).toBe(7);
  }, 20_000);

  it("cancels the restart when a stop comes during the back-off", async () => {
    const fake = await fakeDaemon([{ code: 1 }]);
    const controller = new AbortController();
    const slow = { ...timing, backoffMs: [60_000] };
    const done = runWatchdog({ launch: fake.launch, timing: slow, signal: controller.signal }, project.ctx);
    await expect.poll(async () => (await readWatchdogState(project.paths))?.phase).toBe("backoff");
    expect((await getFactoryStatus(project.ctx)).phase).toBe("starting");
    controller.abort();
    expect(await done).toMatchObject({ phase: "stopped", crashCount: 1 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await fake.starts()).toBe(1);
    expect((await getFactoryStatus(project.ctx)).phase).toBe("stopped");
  });

  it("stops a running daemon on a stop request and does not restart it", async () => {
    const fake = await fakeDaemon([{ sleepMs: 60_000, code: 0 }]);
    const controller = new AbortController();
    const done = runWatchdog({ launch: fake.launch, timing, signal: controller.signal }, project.ctx);
    await expect.poll(() => fake.starts()).toBe(1);
    controller.abort();
    expect(await done).toMatchObject({ phase: "stopped", crashCount: 0 });
    expect(await fake.starts()).toBe(1);
  });

  it("never starts a daemon while an owner is alive", async () => {
    const owner = await newOwner();
    const fake = await fakeDaemon([{ code: 1 }]);
    await acquireFactoryOwnership(project.paths, owner);
    try {
      expect(await runWatchdog({ launch: fake.launch, timing }, project.ctx)).toMatchObject({
        phase: "already-running",
      });
      expect(await fake.starts()).toBe(0);
    } finally {
      await releaseFactoryOwnership(project.paths, owner.token);
    }
  });

  it("does not restart after a crash when an owner became alive during the back-off", async () => {
    const owner = await newOwner();
    const fake = await fakeDaemon([{ code: 1 }]);
    const slow = { ...timing, backoffMs: [300] };
    const done = runWatchdog({ launch: fake.launch, timing: slow }, project.ctx);
    await expect.poll(async () => (await readWatchdogState(project.paths))?.phase).toBe("backoff");
    await acquireFactoryOwnership(project.paths, owner);
    try {
      const result = await done;
      expect(result).toMatchObject({ phase: "stopped", crashCount: 1 });
      expect(result.problem).toMatch(/owner is alive or uncertain/);
      expect(await fake.starts()).toBe(1);
    } finally {
      await releaseFactoryOwnership(project.paths, owner.token);
    }
  });

  it("does not start a second watchdog while one is active", async () => {
    const fake = await fakeDaemon([{ sleepMs: 60_000, code: 0 }]);
    const controller = new AbortController();
    const first = runWatchdog({ launch: fake.launch, timing, signal: controller.signal }, project.ctx);
    await expect.poll(() => fake.starts()).toBe(1);
    // The fake daemon is not an owner, so only the watchdog file stops the second watchdog.
    expect(await runWatchdog({ launch: fake.launch, timing }, project.ctx)).toMatchObject({
      phase: "already-running",
    });
    controller.abort();
    await first;
    expect(await fake.starts()).toBe(1);
  });

  it("lets only one of many concurrent watchdogs start a daemon and write the state file", async () => {
    const fake = await fakeDaemon([{ sleepMs: 60_000, code: 0 }]);
    const controller = new AbortController();
    const settled: string[] = [];
    const runs = Array.from({ length: 5 }, () =>
      runWatchdog({ launch: fake.launch, timing, signal: controller.signal }, project.ctx).then((result) => {
        settled.push(result.phase);
        return result;
      }),
    );
    await expect.poll(() => fake.starts()).toBe(1);
    // The four other watchdogs see the live claim holder and return at once, before the stop.
    await expect.poll(() => settled.length).toBe(4);
    expect(settled).toEqual(Array.from({ length: 4 }, () => "already-running"));
    const state = await readWatchdogState(project.paths);
    expect(state?.phase).toBe("running");
    expect((await readWatchdogClaim(project.paths))?.token).toBe(state?.process.token);
    controller.abort();
    const results = await Promise.all(runs);
    expect(results.filter((result) => result.phase === "stopped")).toHaveLength(1);
    expect(await fake.starts()).toBe(1);
    expect(await readWatchdogClaim(project.paths)).toBeUndefined();
  });

  it("does not write the state file when a different live watchdog holds the claim", async () => {
    const holder = await newOwner();
    const fake = await fakeDaemon([{ code: 1 }]);
    await acquireWatchdogClaim(project.paths, holder);
    expect(await runWatchdog({ launch: fake.launch, timing }, project.ctx)).toMatchObject({
      phase: "already-running",
    });
    expect(await readWatchdogState(project.paths)).toBeUndefined();
    expect(await fake.starts()).toBe(0);
    expect((await readWatchdogClaim(project.paths))?.token).toBe(holder.token);
    expect((await getFactoryStatus(project.ctx)).phase).toBe("starting");
  });
});
