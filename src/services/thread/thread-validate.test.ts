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
    expect(validId("a_b-1")).toBe(true);
    expect(validId("../x")).toBe(false);
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
      record({ usage: { input: -1, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 } }),
      record({ error: { class: "other", code: "x", message: "y" } }),
      record({ session: { id: "other", file: null } }),
      record({ runs: [] }),
      record({ status: "running" }),
      record({ model: { provider: "", modelId: "m" } }),
    ];

    for (const value of invalid) {
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
