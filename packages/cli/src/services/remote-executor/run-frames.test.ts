import { describe, expect, it } from "vitest";
import type { HostRunState } from "../host-agent/host-run-state.js";
import { finalActivity, hasEnded, newFacts, RemoteRunError, receiptFailure, runEnd } from "./run-frames.js";

const USAGE = { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0 };
const base: HostRunState = {
  version: 1,
  threadId: "t1",
  requestId: "r1",
  kind: "launch",
  phase: "running",
  startedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:01.000Z",
};
const worktree = { path: "/w", branch: "story/ROW-1" };
const session = { model: { provider: "p", modelId: "m" }, file: "sessions/t1/s.jsonl" };

describe("run frames", () => {
  it("gives each new value one time, in the order of the events", () => {
    const first = newFacts({}, { ...base, session, worktree });
    expect(first.facts.map((fact) => fact.kind)).toEqual(["worktree", "session"]);

    const repeated = newFacts(first.sent, { ...base, session, worktree });
    expect(repeated.facts).toEqual([]);

    const activity = { lastActivityAt: "2026-01-01T00:00:02.000Z", usage: USAGE };
    const result = { outcome: "complete", summary: "Done", blockers: [], problems: [] };
    const later = newFacts(repeated.sent, { ...base, session, worktree, activity, result });
    expect(later.facts).toEqual([
      { kind: "activity", activity },
      { kind: "result", result },
    ]);
    expect(newFacts(later.sent, { ...base, session, worktree: { ...worktree, branch: "x" } }).facts).toEqual([
      { kind: "worktree", worktree: { ...worktree, branch: "x" } },
    ]);
  });

  it("maps each end reason", () => {
    expect(hasEnded(base)).toBe(false);
    const ended = { ...base, phase: "ended" as const, session };
    expect(runEnd({ ...ended, endReason: "completed" })).toEqual({ kind: "completed" });
    expect(runEnd({ ...ended, endReason: "stopped" })).toEqual({ kind: "completed", stop: "stopped" });
    expect(runEnd({ ...ended, endReason: "cancelled" })).toEqual({ kind: "completed", stop: "cancelled" });

    const failed = runEnd({
      ...ended,
      endReason: "failed",
      failure: { code: "CONFLICT", message: "cannot fast-forward", sessionOpened: false },
    });
    expect(failed.kind).toBe("failed");
    const error = failed.kind === "failed" ? failed.failure.error : undefined;
    expect(error).toBeInstanceOf(RemoteRunError);
    expect(error).toMatchObject({ code: "CONFLICT", message: "cannot fast-forward" });
  });

  it("gives the final usage only for a run with a session", () => {
    expect(finalActivity({ ...base, phase: "ended" })).toBeUndefined();
    expect(
      finalActivity({ ...base, phase: "ended", session, usage: USAGE, endedAt: "2026-01-01T00:00:03.000Z" }),
    ).toEqual({ lastActivityAt: "2026-01-01T00:00:03.000Z", usage: USAGE });
  });

  it("fails a rejected receipt with the error of the host", () => {
    const receipt = { version: 1 as const, id: "r1", ownerToken: "o", status: "accepted" as const };
    expect(receiptFailure(receipt)).toBeUndefined();
    expect(receiptFailure({ ...receipt, status: "rejected", error: { code: "NOT_FOUND", message: "x" } })).toEqual({
      error: expect.objectContaining({ code: "NOT_FOUND", message: "x" }),
      sessionOpened: false,
    });
  });
});
