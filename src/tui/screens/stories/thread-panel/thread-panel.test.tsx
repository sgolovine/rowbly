import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadRecord } from "../../../../services/thread/thread.js";
import { renderTui } from "../../../testing/index.js";
import { ThreadPanel, type ThreadPanelProps } from "./thread-panel.js";

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

function props(overrides: Partial<ThreadPanelProps> = {}): ThreadPanelProps {
  return {
    ctx: { cwd: "/p" },
    storyId: "ROW-01",
    stages: { DEVELOP: "Develop" },
    current: thread,
    now: 0,
    compact: false,
    selected: false,
    shownId: undefined,
    listing: true,
    viewing: false,
    width: 80,
    height: undefined,
    threadWidth: 76,
    conversationHeight: undefined,
    onFocusThread: vi.fn(),
    ...overrides,
  };
}

describe("ThreadPanel", () => {
  it("shows the Story and the thread in the title, and the metadata of the thread", async () => {
    const onFocusThread = vi.fn();
    const tui = await renderTui(<ThreadPanel {...props({ onFocusThread })} />);
    expect(tui.frame()).toContain("ROW-01 › #2 Develop");
    expect(tui.frame()).toMatch(/Status\s+✕ failed/);
    await tui.click("Status");
    expect(onFocusThread).toHaveBeenCalledOnce();
  });

  it("tells when the Story has no thread", async () => {
    const tui = await renderTui(<ThreadPanel {...props({ current: undefined })} />);
    expect(tui.frame()).toContain("The factory adds a thread when it starts a worker for this Story.");
  });
});
