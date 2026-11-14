import { describe, expect, it } from "vitest";
import type { FactoryStatus } from "../../../services/factory/factory.js";
import {
  type CheckQueueJob,
  checkJobRow,
  checkJobTime,
  checksCount,
  liveChecks,
  orderedCheckJobs,
} from "./check-jobs.js";

const NOW = Date.parse("2026-05-01T12:00:00Z");

function job(change: Partial<CheckQueueJob>): CheckQueueJob {
  return {
    id: "j1",
    threadId: "t1",
    storyId: "ROW-01",
    stage: "IN_DEVELOPMENT",
    key: "test",
    scope: "full",
    status: "queued",
    queuedAt: "2026-05-01T11:59:00Z",
    ...change,
  };
}

const CHECKS = {
  running: 1,
  queued: 2,
  maxConcurrent: 2,
  jobs: [job({ id: "q1" }), job({ id: "r1", status: "running", startedAt: "2026-05-01T11:58:56Z" }), job({ id: "q2" })],
};

describe("checkJobs", () => {
  it("gives the checks only for a live factory with a checks section", () => {
    const live = { version: 1, phase: "ready", liveness: "alive", checks: CHECKS } as FactoryStatus;

    expect(liveChecks(live)).toBe(CHECKS);
    expect(liveChecks({ ...live, phase: "stopped" })).toBeUndefined();
    expect(liveChecks({ ...live, liveness: "dead" })).toBeUndefined();
    expect(liveChecks({ ...live, checks: undefined })).toBeUndefined();
    expect(liveChecks(undefined)).toBeUndefined();
  });

  it("counts the running and the queued checks", () => {
    expect(checksCount(CHECKS)).toBe("1/2");
  });

  it("puts the running jobs first and keeps the order of the queue", () => {
    expect(orderedCheckJobs(CHECKS).map((j) => j.id)).toEqual(["r1", "q1", "q2"]);
  });

  it("measures the time since the start of a running job and since the queue time of a queued job", () => {
    expect(checkJobTime(job({ status: "running", startedAt: "2026-05-01T11:58:56Z" }), NOW)).toBe("1m 4s");
    expect(checkJobTime(job({}), NOW)).toBe("1m 0s");
    expect(checkJobTime(job({ queuedAt: "bad" }), NOW)).toBe("—");
  });

  it("writes the Story, the Stage label, the key, the scope, the status and the time", () => {
    expect(checkJobRow(job({ scope: "narrow" }), { IN_DEVELOPMENT: "In Development" }, NOW)).toEqual({
      value: "j1",
      label: "ROW-01 · In Development · test",
      description: "narrow · queued · 1m 0s",
    });
    expect(checkJobRow(job({}), {}, NOW).label).toBe("ROW-01 · IN_DEVELOPMENT · test");
  });
});
