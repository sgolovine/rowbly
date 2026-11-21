import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { workerModelMissingError } from "../factory-settings/worker-model-gate.js";
import { HostUnreachableError } from "../host-transport/host-errors.js";
import type { Story } from "../story/story.js";
import type { ThreadRecord } from "../thread/thread.js";
import { networkWaitingThreads, resumableNetworkThreads, workerFailure } from "./network-wait.js";

const story = { id: "TST-1", stage: "WORK" } as Story;

function thread(patch: Partial<ThreadRecord> = {}): ThreadRecord {
  return {
    version: 1,
    id: "thread-1",
    revision: 1,
    role: "worker",
    storyId: "TST-1",
    stage: "WORK",
    status: "failed",
    createdAt: "2026-01-01T00:00:00.000Z",
    session: { id: "thread-1", file: "/session.jsonl" },
    cwd: "/",
    worktree: "/worktree",
    runs: [{ id: "run-1", ownerToken: "owner", createdAt: "2026-01-01T00:00:00.000Z", status: "failed" }],
    error: { class: "transient", code: "NETWORK", message: "fetch failed" },
    resumable: true,
    model: { provider: "worker", modelId: "m" },
    ...patch,
  };
}

describe("resumableNetworkThreads", () => {
  it("gives a failed NETWORK Thread that can resume", () => {
    expect(resumableNetworkThreads([thread()], [story]).map((t) => t.id)).toEqual(["thread-1"]);
  });

  it.each([
    ["another error", { error: { class: "unknown", code: "WORKER_FAILED", message: "x" } }],
    ["no session file", { resumable: false }],
    ["three runs", { runs: Array.from({ length: 3 }, () => thread().runs[0]) }],
    ["a Stage move", { stage: "REVIEW" }],
    ["no worktree", { worktree: undefined }],
    ["a running Thread", { status: "running" }],
  ] as [string, Partial<ThreadRecord>][])("lets the policy retry after %s", (_, patch) => {
    expect(resumableNetworkThreads([thread(patch)], [story])).toEqual([]);
  });

  it("uses only the last worker Thread of the Story", () => {
    const newer = thread({ id: "thread-2", status: "completed", createdAt: "2026-01-02T00:00:00.000Z" });
    expect(resumableNetworkThreads([newer, thread()], [story])).toEqual([]);
  });
});

describe("networkWaitingThreads", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "network-wait-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("keeps a Thread only when its worktree exists", async () => {
    expect(await networkWaitingThreads([thread({ worktree: dir })], [story])).toHaveLength(1);
    expect(await networkWaitingThreads([thread({ worktree: join(dir, "absent") })], [story])).toEqual([]);
  });
});

describe("workerFailure", () => {
  it("gives a configuration error for a worker without a model", () => {
    expect(workerFailure(workerModelMissingError(), { launched: false, stopping: false })).toMatchObject({
      class: "configuration",
      code: "WORKER_MODEL_MISSING",
    });
  });
  it("gives a transient NETWORK error for a connectivity error", () => {
    const retryAt = "2026-01-01T00:01:00.000Z";
    expect(workerFailure(new Error("fetch failed"), { launched: true, stopping: false, retryAt })).toEqual({
      class: "transient",
      code: "NETWORK",
      message: "fetch failed",
      retryAt,
    });
  });

  it("keeps the other error values", () => {
    expect(workerFailure(new Error("boom"), { launched: true, stopping: false })).toMatchObject({
      class: "unknown",
      code: "WORKER_FAILED",
    });
    expect(workerFailure(new Error("fetch failed"), { launched: false, stopping: true })).toMatchObject({
      class: "launch",
      code: "WORKER_FAILED",
    });
  });

  it("keeps the code of a host connection error and never gives NETWORK for it", () => {
    const error = new HostUnreachableError("Cannot reach mini: ECONNREFUSED fetch failed");
    expect(workerFailure(error, { launched: false, stopping: false })).toEqual({
      class: "launch",
      code: "HOST_UNREACHABLE",
      message: error.message,
    });
  });
});
