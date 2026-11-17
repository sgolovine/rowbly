import { describe, expect, it } from "vitest";
import type { CheckJob } from "./check-types.js";
import { threadCheck, withCheck } from "./thread-checks.js";

const job = (id: string, patch: Partial<CheckJob> = {}): CheckJob => ({
  id,
  ownerToken: "owner",
  threadId: "t1",
  storyId: "ROW-1",
  stage: "WORK",
  rank: 0,
  seq: 1,
  key: "test",
  scope: "full",
  files: [],
  command: "pnpm test",
  cwd: "/work",
  memoryMb: 10,
  timeoutMinutes: 5,
  status: "queued",
  queuedAt: "2026-01-01T00:00:00.000Z",
  ...patch,
});

describe("thread checks", () => {
  it("gives the short record with the head and the duration", () => {
    expect(threadCheck(job("a"), 0)).toEqual({ id: "a", key: "test", scope: "full", status: "queued" });
    expect(
      threadCheck(
        job("a", {
          status: "passed",
          head: "abc",
          startedAt: "2026-01-01T00:00:00.000Z",
          endedAt: "2026-01-01T00:00:12.000Z",
        }),
        0,
      ),
    ).toEqual({ id: "a", key: "test", scope: "full", status: "passed", head: "abc", durationSeconds: 12 });
  });

  it("replaces an entry in place and keeps the last 20 entries", () => {
    const list = Array.from({ length: 20 }, (_, index) => threadCheck(job(`j${index}`), 0));
    const replaced = withCheck(list, { ...list[3], status: "passed" } as (typeof list)[number]);
    expect(replaced[3]?.status).toBe("passed");
    expect(replaced).toHaveLength(20);

    const added = withCheck(list, threadCheck(job("new"), 0));
    expect(added).toHaveLength(20);
    expect(added[0]?.id).toBe("j1");
    expect(added.at(-1)?.id).toBe("new");
  });
});
