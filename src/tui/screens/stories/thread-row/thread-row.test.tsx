import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadRecord } from "../../../../services/thread/thread.js";
import { renderTui } from "../../../testing/index.js";
import { ThreadRow } from "./thread-row.js";

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
  startedAt: "2026-11-12T10:00:00.000Z",
  completedAt: "2026-11-12T10:04:12.000Z",
  session: { id: "t", file: null },
  cwd: "/p",
  runs: [{ id: "r", ownerToken: "o", createdAt: "2026-11-12T10:00:00.000Z", status: "failed" }],
  error: { class: "quota", code: "QUOTA", message: "Provider quota reached" },
  resumable: false,
};

describe("ThreadRow", () => {
  it("shows the status, the Stage and attempt, the run time, the model, the date and the error", async () => {
    const tui = await renderTui(
      <ThreadRow thread={thread} stages={{ DEVELOP: "Develop" }} now={0} selected clickable onClick={() => {}} />,
    );
    expect(tui.frame()).toMatch(/▌ ✕ failed #2 Develop\s+4m 12s/);
    expect(tui.frame()).toContain("claude · 12 Nov 2026");
    expect(tui.frame()).toContain("Provider quota reached");
  });

  it("calls onClick on a click", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(<ThreadRow thread={thread} now={0} selected={false} clickable onClick={onClick} />);
    await tui.click("#2 DEVELOP");
    expect(onClick).toHaveBeenCalledOnce();
  });
});
