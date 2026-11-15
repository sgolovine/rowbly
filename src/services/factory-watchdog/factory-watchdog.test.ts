import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { newOwner } from "../factory-ownership/factory-ownership.js";
import { useTestProject } from "../test-project/test-project.js";
import {
  acquireWatchdogClaim,
  activeWatchdog,
  BACKOFF_MS,
  backoffMs,
  CRASH_LIMIT,
  CRASH_LIMIT_KEY,
  classifyExit,
  crashCountAfter,
  crashLimitReached,
  crashLimitText,
  exitText,
  liveWatchdog,
  readWatchdogClaim,
  readWatchdogState,
  releaseWatchdogClaim,
  STABLE_MS,
  type WatchdogState,
  watchdogActive,
  writeWatchdogState,
} from "./factory-watchdog.js";

describe("watchdog policy", () => {
  it("has the constants of the Story", () => {
    expect(BACKOFF_MS).toEqual([1000, 2000, 4000, 8000, 16_000]);
    expect(CRASH_LIMIT).toBe(5);
    expect(STABLE_MS).toBe(300_000);
    expect(CRASH_LIMIT_KEY).toBe("watchdog:crash-limit");
  });

  it("classifies a non-zero code, a signal and a launch error as a crash, and code 0 or a stop as no crash", () => {
    expect(classifyExit({ code: 0, signal: null }, false)).toBe("clean");
    expect(classifyExit({ code: 1, signal: null }, false)).toBe("crash");
    expect(classifyExit({ code: null, signal: "SIGKILL" }, false)).toBe("crash");
    expect(classifyExit({ code: null, signal: null, error: "ENOENT" }, false)).toBe("crash");
    expect(classifyExit({ code: 1, signal: null }, true)).toBe("stop");
    expect(classifyExit({ code: null, signal: "SIGTERM" }, true)).toBe("stop");
  });

  it("doubles the back-off for each crash in a row and keeps the last value as the limit", () => {
    expect([1, 2, 3, 4, 5, 6, 9].map((count) => backoffMs(count))).toEqual([
      1000, 2000, 4000, 8000, 16_000, 16_000, 16_000,
    ]);
    expect(backoffMs(0)).toBe(1000);
  });

  it("sets the count to 0 after the stable period and stops at the crash limit", () => {
    expect(crashCountAfter(3, 1000)).toBe(4);
    expect(crashCountAfter(3, STABLE_MS)).toBe(1);
    expect(crashCountAfter(3, 60, { backoffMs: [1], crashLimit: 5, stableMs: 50 })).toBe(1);
    expect(crashLimitReached(4)).toBe(false);
    expect(crashLimitReached(5)).toBe(true);
  });

  it("writes the exit as text", () => {
    expect(exitText({ code: 3, signal: null })).toBe("code 3");
    expect(exitText({ code: null, signal: "SIGKILL" })).toBe("signal SIGKILL");
    expect(exitText({ code: null, signal: null, error: "spawn ENOENT" })).toBe("launch error spawn ENOENT");
  });
});

describe("watchdog state file", () => {
  const project = useTestProject();

  async function state(phase: WatchdogState["phase"]): Promise<WatchdogState> {
    const self = await newOwner();
    return { version: 1, pid: self.pid, process: self, phase, crashCount: 2, updatedAt: new Date().toISOString() };
  }

  it("writes the file with mode 0600 and reads it again", async () => {
    const written = await state("backoff");
    await writeWatchdogState(project.paths, written);
    const path = join(project.paths.runtimeDir, "watchdog.json");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readWatchdogState(project.paths)).toEqual(written);
  });

  it("gives no state for a missing or a corrupt file", async () => {
    expect(await readWatchdogState(project.paths)).toBeUndefined();
    await writeWatchdogState(project.paths, await state("running"));
    await writeFile(join(project.paths.runtimeDir, "watchdog.json"), "{ not json");
    expect(await readWatchdogState(project.paths)).toBeUndefined();
    await writeFile(join(project.paths.runtimeDir, "watchdog.json"), JSON.stringify({ version: 1, phase: "odd" }));
    expect(await readWatchdogState(project.paths)).toBeUndefined();
  });

  it("finds an active watchdog only when its process is alive", async () => {
    const running = await state("running");
    await writeWatchdogState(project.paths, running);
    expect(await activeWatchdog(project.paths)).toEqual({ state: running, liveness: "alive" });
    expect(await activeWatchdog(project.paths, async () => "dead")).toBeUndefined();
    await writeWatchdogState(project.paths, await state("failed"));
    expect(await activeWatchdog(project.paths)).toBeUndefined();
    expect(watchdogActive(await state("stopped"))).toBe(false);
    expect(watchdogActive(await state("backoff"))).toBe(true);
  });

  it("names the count, the last exit and the log in the crash-limit text", async () => {
    const failed = { ...(await state("failed")), crashCount: 5, lastExit: "signal SIGKILL", lastLog: "/tmp/x.jsonl" };
    expect(crashLimitText(failed)).toContain("crashed 5 times");
    expect(crashLimitText(failed)).toContain("signal SIGKILL");
    expect(crashLimitText(failed)).toContain("/tmp/x.jsonl");
  });

  it("gives the watchdog claim to one holder and replaces only a dead holder", async () => {
    const first = await newOwner();
    const second = await newOwner();
    expect((await acquireWatchdogClaim(project.paths, first)).acquired).toBe(true);
    expect(await acquireWatchdogClaim(project.paths, second)).toEqual({ acquired: false, owner: first });
    expect((await acquireWatchdogClaim(project.paths, second, async () => "dead")).acquired).toBe(true);
    expect((await readWatchdogClaim(project.paths))?.token).toBe(second.token);
    expect(await releaseWatchdogClaim(project.paths, first.token)).toBe(false);
    expect(await releaseWatchdogClaim(project.paths, second.token)).toBe(true);
    expect(await readWatchdogClaim(project.paths)).toBeUndefined();
  });

  it("gives only one claim to concurrent holders", async () => {
    const owners = await Promise.all(Array.from({ length: 5 }, () => newOwner()));
    const results = await Promise.all(owners.map((owner) => acquireWatchdogClaim(project.paths, owner)));
    expect(results.filter((result) => result.acquired)).toHaveLength(1);
  });

  it("finds a live claim holder before it writes the state file, but not after its last phase", async () => {
    const holder = await newOwner();
    await writeWatchdogState(project.paths, { ...(await state("stopped")), process: { ...holder, token: "old" } });
    expect(await liveWatchdog(project.paths)).toBeUndefined();
    await acquireWatchdogClaim(project.paths, holder);
    expect(await liveWatchdog(project.paths)).toEqual({ process: holder, liveness: "alive" });
    expect(await liveWatchdog(project.paths, async () => "dead")).toBeUndefined();
    await writeWatchdogState(project.paths, { ...(await state("stopped")), process: holder });
    expect(await liveWatchdog(project.paths)).toBeUndefined();
    await writeWatchdogState(project.paths, { ...(await state("backoff")), process: holder });
    expect(await liveWatchdog(project.paths)).toEqual({ process: holder, liveness: "alive" });
  });

  it("finds a live claim holder when its state changes from missing to running between the reads", async () => {
    const holder = await newOwner();
    const running: WatchdogState = { ...(await state("running")), process: holder };
    let stateReads = 0;
    let claimReads = 0;
    const reader = {
      // The claim read sees the holder. The state file has no record yet.
      claim: async () => {
        claimReads += 1;
        return holder;
      },
      // The holder writes its first `running` record after the claim read.
      state: async () => {
        stateReads += 1;
        return running;
      },
    };
    expect(await liveWatchdog(project.paths, async () => "alive", reader)).toEqual({
      process: holder,
      liveness: "alive",
    });
    expect({ claimReads, stateReads }).toEqual({ claimReads: 1, stateReads: 1 });

    // The claim read sees no holder, and then the new holder takes the claim and writes `running`.
    const late = { claim: async () => undefined, state: async () => running };
    expect(await liveWatchdog(project.paths, async () => "alive", late)).toEqual({
      process: holder,
      liveness: "alive",
    });

    // The claim read sees the holder, and the state read sees its last phase: it is about to exit.
    const done = { claim: async () => holder, state: async () => ({ ...running, phase: "stopped" as const }) };
    expect(await liveWatchdog(project.paths, async () => "alive", done)).toBeUndefined();
  });
});
