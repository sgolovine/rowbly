import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { ThreadRecord } from "../../../../services/thread/thread.js";
import { renderTui } from "../../../testing/index.js";
import { ThreadDetail } from "./thread-detail.js";

afterEach(cleanup);

const thread: ThreadRecord = {
  version: 1,
  id: "t",
  revision: 3,
  role: "worker",
  storyId: "ROW-01",
  stage: "DEVELOP",
  model: { provider: "anthropic", modelId: "claude" },
  status: "interrupted",
  createdAt: "2026-11-12T10:00:00.000Z",
  startedAt: "2026-11-12T10:00:00.000Z",
  completedAt: "2026-11-12T10:00:45.000Z",
  lastActivityAt: "2026-11-12T10:00:40.000Z",
  lastTool: "bash",
  session: { id: "t", file: "sessions/t/history.jsonl" },
  cwd: "/p",
  worktree: "/p/.worktrees/ROW-01",
  branch: "story/ROW-01",
  runs: [
    { id: "r1", ownerToken: "o", createdAt: "2026-11-12T09:00:00.000Z", status: "interrupted" },
    {
      id: "r2",
      ownerToken: "o",
      createdAt: "2026-11-12T10:00:00.000Z",
      status: "interrupted",
      reason: "Factory stopped",
    },
  ],
  resumable: true,
};

describe("ThreadDetail", () => {
  it("shows the status, the model, the times, the last tool, the worktree and the reason", async () => {
    const tui = await renderTui(<ThreadDetail thread={thread} now={0} />);
    const frame = tui.frame();
    expect(frame).toContain("! interrupted · run 2 · resumable");
    expect(frame).toContain("anthropic/claude");
    expect(frame).toMatch(/Started\s+12 Nov 2026, \d\d:\d\d · 45s/);
    expect(frame).toMatch(/Activity\s+12 Nov 2026, \d\d:\d\d · bash/);
    expect(frame).toContain("story/ROW-01 · /p/.worktrees/ROW-01");
    expect(frame).toContain("Factory stopped");
  });

  it("shows one status line and the result when compact", async () => {
    const tui = await renderTui(<ThreadDetail thread={thread} now={0} compact />);
    expect(tui.frame().split("\n")).toEqual([
      "! interrupted · run 2 · resumable · anthropic/claude · 45s",
      "Factory stopped",
    ]);
  });
});
