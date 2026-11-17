import { describe, expect, it } from "vitest";
import { validateThread, validId } from "./thread-validate.js";

const record = (changes: object = {}) => ({
  version: 1,
  id: "t1",
  revision: 1,
  role: "worker",
  storyId: "ROW-1",
  stage: "DEVELOP",
  status: "pending",
  createdAt: "2026-11-13T00:00:00.000Z",
  session: { id: "t1", file: null },
  cwd: "/tmp",
  runs: [{ id: "r1", ownerToken: "owner", createdAt: "2026-11-13T00:00:00.000Z", status: "pending" }],
  resumable: false,
  ...changes,
});

describe("thread validation", () => {
  it("accepts valid metadata and safe IDs", () => {
    expect(validateThread(record())).toMatchObject({ id: "t1" });
    expect(validateThread(record({ host: "local" })).host).toBe("local");
    expect(validateThread(record({ storyUid: "11111111-1111-4111-8111-111111111111" })).storyUid).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect("storyUid" in validateThread(record())).toBe(false);
    expect(validId("a_b-1")).toBe(true);
    expect(validId("../x")).toBe(false);
    expect(
      validateThread(record({ checks: [{ id: "j1", key: "test", scope: "full", status: "passed" }] })),
    ).toBeTruthy();
  });

  it("rejects invalid metadata", () => {
    const invalid = [
      null,
      record({ version: 2 }),
      record({ revision: 0 }),
      record({ storyId: undefined }),
      record({ stage: "develop" }),
      record({ attemptNumber: 0 }),
      record({ startedAt: "never" }),
      record({ worktree: "relative" }),
      record({ host: "" }),
      record({ host: 7 }),
      record({ storyUid: 7 }),
      record({ storyUid: null }),
      record({ usage: { input: -1, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 } }),
      record({ error: { class: "other", code: "x", message: "y" } }),
      record({ session: { id: "other", file: null } }),
      record({ runs: [] }),
      record({ status: "running" }),
      record({ model: { provider: "", modelId: "m" } }),
      record({ checks: [{ id: "j1", key: "test", scope: "full" }] }),
      record({ checks: Array(21).fill({ id: "j1", key: "test", scope: "full", status: "passed" }) }),
    ];

    for (const value of invalid) {
      expect(() => validateThread(value)).toThrow("Invalid thread metadata");
    }
  });

  it("checks the abandoned note and the remote outcome of a remote Thread", () => {
    const abandoned = { at: "2026-11-13T00:00:00.000Z", reason: "cancel", appliedSeq: 4 };
    const remoteOutcome = {
      endReason: "failed",
      endedAt: "2026-11-13T01:00:00.000Z",
      failure: { code: "X", message: "y" },
    };

    expect(validateThread(record({ abandoned, remoteOutcome }))).toMatchObject({ abandoned, remoteOutcome });
    for (const value of [
      record({ abandoned: { ...abandoned, reason: "other" } }),
      record({ abandoned: { ...abandoned, at: "never" } }),
      record({ abandoned: { ...abandoned, appliedSeq: -1 } }),
      record({ abandoned: null }),
      record({ remoteOutcome: { endReason: "gone" } }),
      record({ remoteOutcome: { endReason: "failed", failure: { code: 1 } } }),
      record({ remoteOutcome: { endReason: "completed", result: { outcome: "x" } } }),
    ]) {
      expect(() => validateThread(value)).toThrow("Invalid thread metadata");
    }
  });

  it("rejects an invalid worker result after valid metadata", () => {
    const result = { outcome: "done", summary: "ok", blockers: [], problems: [] };

    expect(validateThread(record({ result })).result).toEqual(result);
    expect(() => validateThread(record({ result: { ...result, summary: "x".repeat(1001) } }))).toThrow(
      "Invalid worker result",
    );
    expect(() => validateThread(record({ result: { ...result, blockers: Array(11).fill("b") } }))).toThrow(
      "Invalid worker result",
    );
    expect(() => validateThread(record({ result: { ...result, commits: [1] } }))).toThrow("Invalid worker result");
  });
});
