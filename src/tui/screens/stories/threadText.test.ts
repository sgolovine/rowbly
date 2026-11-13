import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTestProject } from "../../../services/testProject/testProject.js";
import type { ThreadRecord } from "../../../services/thread/thread.js";
import { appendThreadRun, createThread, transitionThread } from "../../../services/thread/thread.js";
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
  const project = useTestProject();
  it("shows the new result after an interrupted thread resumes and completes", async () => {
    const t = await createThread(
      { role: "worker", storyId: "ROW-01", stage: "BACKLOG", cwd: project.paths.root, ownerToken: "dead" },
      project.ctx,
    );
    const file = `sessions/${t.id}/history.jsonl`;
    await mkdir(join(project.paths.runtimeDir, `sessions/${t.id}`), { recursive: true });
    await writeFile(join(project.paths.runtimeDir, file), "");
    const interrupted = await transitionThread(
      t.id,
      {
        expectedRevision: t.revision,
        status: "interrupted",
        patch: {
          session: { id: t.id, file },
          resumable: true,
          error: { class: "unknown", code: "OWNER_DIED", message: "Previous owner died" },
        },
      },
      project.ctx,
    );
    const resumed = await appendThreadRun(
      t.id,
      { expectedRevision: interrupted.revision, ownerToken: "live" },
      project.ctx,
    );
    const running = await transitionThread(
      t.id,
      {
        expectedRevision: resumed.revision,
        status: "running",
        patch: {
          error: { class: "transient", code: "TEMP", message: "Temporary failure" },
        },
      },
      project.ctx,
    );
    const completed = await transitionThread(
      t.id,
      {
        expectedRevision: running.revision,
        status: "completed",
        patch: {
          result: { outcome: "success", summary: "New work completed", blockers: [], problems: [] },
        },
      },
      project.ctx,
    );
    expect(completed.error).toBeUndefined();
    expect(completed.runs[0].reason).toBe("Previous owner died");
    expect(threadOutcome(completed)).toEqual({ text: "success: New work completed", error: false });
  });

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
