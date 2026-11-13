import { describe, expect, it } from "vitest";
import type { ThreadRecord } from "../../../services/thread/thread.js";
import {
  formatDuration,
  sortThreads,
  threadDuration,
  threadName,
  threadOutcome,
  threadResumable,
} from "./threadText.js";

function thread(fields: Partial<ThreadRecord>): ThreadRecord {
  return {
    version: 1,
    id: "t",
    revision: 1,
    role: "worker",
    storyId: "ROW-01",
    stage: "DEVELOP",
    status: "pending",
    createdAt: "2026-11-12T10:00:00.000Z",
    session: { id: "t", file: null },
    cwd: "/p",
    runs: [{ id: "r", ownerToken: "o", createdAt: "2026-11-12T10:00:00.000Z", status: "pending" }],
    resumable: false,
    ...fields,
  };
}

describe("threadText", () => {
  it("puts active threads first, then the newest", () => {
    const old = thread({ id: "old", status: "completed", createdAt: "2026-11-10T00:00:00.000Z" });
    const recent = thread({ id: "recent", status: "failed", createdAt: "2026-11-12T00:00:00.000Z" });
    const running = thread({ id: "running", status: "running", createdAt: "2026-11-01T00:00:00.000Z" });
    expect(sortThreads([old, recent, running]).map((t) => t.id)).toEqual(["running", "recent", "old"]);
  });

  it("names, times and explains a thread", () => {
    expect(threadName(thread({ attemptNumber: 2 }))).toBe("#2 DEVELOP");
    expect(threadName(thread({ attemptNumber: 2 }), { DEVELOP: "Develop" })).toBe("#2 Develop");
    expect(threadName(thread({ role: "supervisor" }))).toBe("Supervisor");
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(252_000)).toBe("4m 12s");
    expect(formatDuration(7_500_000)).toBe("2h 5m");
    const started = thread({ status: "running", startedAt: "2026-11-12T10:00:00.000Z" });
    expect(threadDuration(started, Date.parse("2026-11-12T10:01:30.000Z"))).toBe("1m 30s");
    expect(threadDuration(thread({}), Date.now())).toBe("");
    expect(threadOutcome(thread({ error: { class: "quota", code: "Q", message: "Quota" } }))).toEqual({
      text: "Quota",
      error: true,
    });
  });

  it("resumes only a resumable thread that stopped and has a session", () => {
    const file = "sessions/t/history.jsonl";
    expect(threadResumable(thread({ status: "interrupted", resumable: true, session: { id: "t", file } }))).toBe(true);
    expect(threadResumable(thread({ status: "running", resumable: true, session: { id: "t", file } }))).toBe(false);
    expect(threadResumable(thread({ status: "interrupted", resumable: true }))).toBe(false);
  });
});
