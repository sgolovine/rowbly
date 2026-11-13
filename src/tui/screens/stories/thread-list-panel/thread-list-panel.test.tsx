import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadRecord } from "../../../../services/thread/thread.js";
import { renderTui } from "../../../testing/index.js";
import { ThreadListPanel, type ThreadListPanelProps } from "./thread-list-panel.js";

afterEach(cleanup);

const thread: ThreadRecord = {
  version: 1,
  id: "t",
  revision: 2,
  role: "worker",
  storyId: "ROW-01",
  stage: "DEVELOP",
  attemptNumber: 2,
  model: { provider: "anthropic", modelId: "claude" },
  status: "failed",
  createdAt: "2026-11-12T10:00:00.000Z",
  completedAt: "2026-11-12T10:04:12.000Z",
  session: { id: "t", file: null },
  cwd: "/p",
  runs: [{ id: "r", ownerToken: "o", createdAt: "2026-11-12T10:00:00.000Z", status: "failed" }],
  resumable: false,
};

function props(overrides: Partial<ThreadListPanelProps> = {}): ThreadListPanelProps {
  return {
    threads: [thread],
    stages: { DEVELOP: "Develop" },
    now: 0,
    cursor: 0,
    waiting: undefined,
    listing: true,
    viewing: false,
    width: 42,
    height: undefined,
    innerHeight: undefined,
    onFocusList: vi.fn(),
    onClickRow: vi.fn(),
    ...overrides,
  };
}

describe("ThreadListPanel", () => {
  it("shows the threads, and gives the index of a clicked row", async () => {
    const onClickRow = vi.fn();
    const tui = await renderTui(<ThreadListPanel {...props({ onClickRow })} />);
    expect(tui.frame()).toContain("Threads");
    expect(tui.frame()).toContain("#2 Develop");
    await tui.click("#2 Develop");
    expect(onClickRow).toHaveBeenCalledWith(0);
  });

  it("says when there are no threads, and shows the queue note with a capital letter", async () => {
    const tui = await renderTui(
      <ThreadListPanel
        {...props({
          threads: [],
          waiting: { story: "ROW-01", stage: "DEVELOP", action: "skip", reason: "worker limit" },
        })}
      />,
    );
    expect(tui.frame()).toContain("No Threads");
    expect(tui.frame()).toContain("Waiting for a worker slot");
  });
});
