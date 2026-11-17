import { describe, expect, it, vi } from "vitest";
import type { WorkerEvents } from "../factory-manager/worker-executor.js";
import type { HostRunState } from "../host-agent/host-run-state.js";
import type { ThreadRecord } from "../thread/thread.js";
import { endSyncedRuns, endWait, newRemoteRun, takeRunFrame, waitForAbort, waitsForSync } from "./remote-run.js";

const frame = (patch: Partial<HostRunState>): HostRunState => ({
  version: 1,
  threadId: "t1",
  requestId: "c1",
  kind: "launch",
  phase: "running",
  startedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...patch,
});

function events(log: string[], throwOn?: string): WorkerEvents {
  const push = (name: string) => async () => {
    if (name === throwOn) throw new Error(`${name} failed`);
    log.push(name);
  };
  return {
    worktreeReady: push("worktree"),
    sessionOpened: push("session"),
    message: async () => "",
    prompted: () => undefined,
    activity: push("activity"),
    resultReported: push("result"),
    stopping: () => false,
    completed: push("completed"),
    failed: push("failed"),
    finished: push("finished"),
  };
}

describe("remote run", () => {
  it("ignores the frames of a different command, and waits for the sync before the end", async () => {
    const log: string[] = [];
    const run = newRemoteRun({ id: "t1" } as ThreadRecord, "mini", events(log));
    const sync = vi.fn(async () => {
      throw new Error("offline");
    });
    const hooks = { sync, stopHost: async () => undefined, catchUp: async () => undefined };
    run.store.update(() => ({ commandId: "c1" }));

    takeRunFrame(run, frame({ requestId: "old", phase: "ended", endReason: "completed" }), hooks);
    takeRunFrame(run, frame({ worktree: { path: "/w", branch: undefined } }), hooks);
    takeRunFrame(
      run,
      frame({ phase: "ended", endReason: "completed", worktree: { path: "/w", branch: undefined } }),
      hooks,
    );
    await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
    await run.store.current.chain;

    expect(log).toEqual(["worktree"]);
    expect(waitsForSync(run)).toBe(true);

    await endSyncedRuns([run], hooks);
    await waitForAbort(run.done.signal);
    expect(log).toEqual(["worktree", "completed"]);
    expect(waitsForSync(run)).toBe(false);
  });

  it("fails the run and stops the work on the host when an event throws", async () => {
    const log: string[] = [];
    const run = newRemoteRun({ id: "t1" } as ThreadRecord, "mini", events(log, "session"));
    const stopHost = vi.fn(async () => undefined);
    run.store.update(() => ({ commandId: "c1" }));

    takeRunFrame(run, frame({ session: { model: { provider: "p", modelId: "m" }, file: "f" } }), {
      sync: async () => undefined,
      stopHost,
      catchUp: async () => undefined,
    });
    await waitForAbort(run.done.signal);

    expect(log).toEqual(["failed"]);
    expect(stopHost).toHaveBeenCalledWith(run);
  });

  it("ends the wait without an event", async () => {
    const log: string[] = [];
    const run = newRemoteRun({ id: "t1" } as ThreadRecord, "mini", events(log));

    endWait(run);
    await waitForAbort(run.done.signal);

    expect(run.store.current.closed).toBe(true);
    expect(log).toEqual([]);
  });
});
