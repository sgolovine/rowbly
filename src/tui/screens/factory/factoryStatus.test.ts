import { describe, expect, it } from "vitest";
import type { FactoryStatus } from "../../../services/factory/factory.js";
import { factoryLive, factoryProblems, factoryState, queueEntry, queueReason } from "./factoryStatus.js";

const ready: FactoryStatus = {
  version: 1,
  phase: "ready",
  liveness: "alive",
  responsive: true,
  workers: { running: 2, pending: 1, waiting: 0, limit: 4 },
  attention: [
    ["commit", { text: "Canonical commit: failed", storyId: "ROW-01" }],
    { file: "threads/x.json", message: "bad" },
  ],
  providers: { anthropic: { reason: "quota" } },
  queue: [{ story: "ROW-02", stage: "DEVELOP", action: "skip", reason: "worker limit" }],
} as unknown as FactoryStatus;

describe("factoryStatus", () => {
  it("names the state of each phase and the counts of a ready factory", () => {
    expect(factoryState(undefined)).toBe("…");
    expect(factoryState({ version: 1, phase: "stopped" })).toBe("off");
    expect(factoryState({ version: 1, phase: "starting" })).toBe("starting");
    expect(factoryState(ready)).toBe("2/4 · 1 pending");
    expect(factoryState(ready, true)).toBe("2/4");
  });

  it("lists attention items, issues and paused providers only while the factory runs", () => {
    expect(factoryProblems(ready).map((p) => p.text)).toEqual([
      "ROW-01: Canonical commit: failed",
      "threads/x.json: bad",
      "Provider anthropic is paused (quota).",
    ]);
    expect(factoryProblems({ ...ready, responsive: false })[0]?.text).toContain("heartbeat");
    expect(factoryProblems({ ...ready, phase: "stopped" })).toEqual([]);
    expect(factoryLive({ ...ready, liveness: "dead" })).toBe(false);
  });

  it("finds the queue entry of a Story and says why it waits", () => {
    const entry = queueEntry(ready, "ROW-02");
    expect(entry && queueReason(entry)).toBe("waiting for a worker slot");
    expect(queueEntry({ ...ready, phase: "stopped" }, "ROW-02")).toBeUndefined();
    expect(queueReason({ story: "ROW-03", stage: "X", action: "start", reason: "new stage stay" })).toBe(
      "waiting for the supervisor",
    );
  });
});
