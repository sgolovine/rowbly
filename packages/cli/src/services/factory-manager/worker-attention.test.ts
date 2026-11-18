import { describe, expect, it } from "vitest";
import type { ThreadRecord } from "../thread/thread.js";
import type { Attention } from "./manager-state.js";
import {
  failureAttentionText,
  resultAttentionText,
  WORKER_ATTENTION,
  withFailureAttention,
  withoutStaleWorkerAttention,
  withResultAttention,
  workerAttentionKey,
} from "./worker-attention.js";

const thread = { id: "thread-1", stage: "WORK", storyId: "ROW-07" };
const result = (blockers: string[], problems: string[]) => ({
  outcome: "blocked",
  summary: "Done",
  blockers,
  problems,
});
const empty: ReadonlyMap<string, Attention> = new Map();
const worker = (id: string, storyId: string, stage: string, createdAt: string) =>
  ({ id, role: "worker", storyId, stage, createdAt }) as ThreadRecord;

describe("worker attention text", () => {
  it("names the Story, the Stage, the Thread, the outcome, the blockers and the problems", () => {
    expect(resultAttentionText(thread, result(["CI is red"], ["Flaky test"]))).toBe(
      "ROW-07 in WORK: worker thread-1 ended with outcome blocked. Blockers: CI is red. Problems: Flaky test.",
    );
  });

  it("shows the first three items and the number of the other items", () => {
    const text = resultAttentionText(thread, result(["a", "b", "c", "d", "e"], []));

    expect(text).toBe("ROW-07 in WORK: worker thread-1 ended with outcome blocked. Blockers: a; b; c (+2 more).");
  });

  it("keeps the text at a maximum of 1000 characters with many long items", () => {
    const long = Array.from({ length: 50 }, (_, index) => `${index} ${"x".repeat(5000)}`);

    expect(resultAttentionText(thread, result(long, long)).length).toBeLessThanOrEqual(1000);
    expect(resultAttentionText(thread, result(long, long))).toContain("Problems: 0 x");
    expect(
      failureAttentionText(thread, { class: "unknown", code: "WORKER_FAILED", message: "y".repeat(5000) }).length,
    ).toBe(1000);
  });

  it("gives the code and the message of a failure", () => {
    expect(failureAttentionText(thread, { class: "unknown", code: "WORKER_FAILED", message: "Boom" })).toBe(
      "ROW-07 in WORK: worker thread-1 failed (WORKER_FAILED): Boom",
    );
  });
});

describe("withResultAttention", () => {
  it("sets the entry for one blocker or one problem", () => {
    for (const reported of [result(["Blocked"], []), result([], ["Problem"])]) {
      const entry = withResultAttention(empty, thread, reported).get(`${WORKER_ATTENTION}ROW-07`);

      expect(entry?.storyId).toBe("ROW-07");
      expect(entry?.text).toContain("thread-1");
    }
  });

  it("removes the entry for a result without blockers and problems, and keeps the other entries", () => {
    const attention = new Map([
      ["worker:ROW-07", { text: "Old" }],
      ["commit", { text: "Commit" }],
    ]);

    expect([...withResultAttention(attention, thread, result([], [])).keys()]).toEqual(["commit"]);
  });

  it("does not change the attention without a reported result", () => {
    const attention = new Map([["worker:ROW-07", { text: "Old" }]]);

    expect(withResultAttention(attention, thread, undefined)).toBe(attention);
  });
});

describe("withFailureAttention", () => {
  it("sets the entry with the error message", () => {
    const error = { class: "unknown" as const, code: "WORKER_FAILED", message: "Boom" };

    expect(withFailureAttention(empty, thread, error).get(workerAttentionKey("ROW-07"))).toEqual({
      text: "ROW-07 in WORK: worker thread-1 failed (WORKER_FAILED): Boom",
      storyId: "ROW-07",
    });
  });

  it("does not set the entry for a connectivity failure", () => {
    const error = { class: "transient" as const, code: "NETWORK", message: "fetch failed" };

    expect(withFailureAttention(empty, thread, error).size).toBe(0);
  });
});

describe("withoutStaleWorkerAttention", () => {
  const attention = new Map([
    ["worker:ROW-01", { text: "Stays", storyId: "ROW-01" }],
    ["worker:ROW-02", { text: "Moved", storyId: "ROW-02" }],
    ["worker:ROW-03", { text: "Deleted", storyId: "ROW-03" }],
    ["upstream-stuck:ROW-03", { text: "Other", storyId: "ROW-03" }],
  ]);
  const threads = [
    worker("t1", "ROW-01", "BUILD", "2026-01-01T00:00:00.000Z"),
    worker("t2", "ROW-01", "WORK", "2026-01-02T00:00:00.000Z"),
    worker("t3", "ROW-02", "WORK", "2026-01-01T00:00:00.000Z"),
    worker("t4", "ROW-03", "WORK", "2026-01-01T00:00:00.000Z"),
  ];

  it("removes the entry of a Story that left the Stage of its last worker, or that is deleted", () => {
    const stories = [
      { id: "ROW-01", stage: "WORK" },
      { id: "ROW-02", stage: "REVIEW" },
    ];

    expect([...withoutStaleWorkerAttention(attention, stories, threads).keys()]).toEqual([
      "worker:ROW-01",
      "upstream-stuck:ROW-03",
    ]);
  });
});
