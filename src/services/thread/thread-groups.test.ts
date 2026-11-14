import { describe, expect, it } from "vitest";
import { groupThreads } from "./thread-groups.js";
import type { ThreadRecord, ThreadStatus } from "./thread-types.js";

function thread(id: string, status: ThreadStatus, change: Partial<ThreadRecord> = {}): ThreadRecord {
  return {
    version: 1,
    id,
    revision: 1,
    role: "worker",
    storyId: "ROW-01",
    stage: "DEVELOP",
    status,
    createdAt: `2026-11-12T10:00:0${id.slice(1)}.000Z`,
    session: { id, file: null },
    cwd: "/p",
    runs: [],
    resumable: false,
    ...change,
  };
}

describe("groupThreads", () => {
  it("puts pending and running Threads in active, and the other statuses in inactive, newest first", () => {
    const threads = [
      thread("t1", "completed"),
      thread("t2", "failed"),
      thread("t3", "cancelled"),
      thread("t4", "interrupted"),
      thread("t5", "running"),
      thread("t6", "pending"),
    ];

    const groups = groupThreads(threads);

    expect(groups.active.map((t) => t.id)).toEqual(["t6", "t5"]);
    expect(groups.inactive.map((t) => t.id)).toEqual(["t4", "t3", "t2", "t1"]);
  });

  it("keeps only worker Threads with a Story", () => {
    const threads = [
      thread("t1", "running"),
      thread("t2", "running", { role: "supervisor", storyId: undefined }),
      thread("t3", "completed", { storyId: undefined }),
    ];

    const groups = groupThreads(threads);

    expect(groups.active.map((t) => t.id)).toEqual(["t1"]);
    expect(groups.inactive).toEqual([]);
  });

  it("keeps only the Threads of the Stage when a Stage is given", () => {
    const threads = [thread("t1", "running"), thread("t2", "completed", { stage: "REVIEW" }), thread("t3", "failed")];

    expect(groupThreads(threads, "REVIEW")).toEqual({ active: [], inactive: [threads[1]] });
    expect(groupThreads(threads).inactive).toHaveLength(2);
  });
});
