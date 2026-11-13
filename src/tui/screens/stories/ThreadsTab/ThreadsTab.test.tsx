import { cleanup } from "ink-testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FactoryStatus } from "../../../../services/factory/factory.js";
import * as factory from "../../../../services/factory/factory.js";
import { useTestProject } from "../../../../services/testProject/testProject.js";
import { createThread, type ThreadStatus, transitionThread } from "../../../../services/thread/thread.js";
import { LayoutContext } from "../../../hooks/index.js";
import { keys, renderTui, settle } from "../../../testing/index.js";
import { ThreadsTab } from "./ThreadsTab.js";

vi.mock("../../../../services/factory/factory.js", async (original) => ({
  ...(await original<typeof import("../../../../services/factory/factory.js")>()),
  getFactoryStatus: vi.fn(async () => ({ version: 1, phase: "stopped" })),
  sendFactoryCommand: vi.fn(async () => ({ status: "completed" })),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ThreadsTab", () => {
  const project = useTestProject();
  const ids: Partial<Record<ThreadStatus, string>> = {};

  /** One thread for `ROW-01` in each status, created one minute apart, oldest first. */
  beforeEach(async () => {
    const statuses: ThreadStatus[] = ["completed", "failed", "cancelled", "interrupted", "running", "pending"];
    for (const [i, status] of statuses.entries()) {
      const ctx = { ...project.ctx, now: () => new Date(Date.UTC(2026, 10, 12, 10, i)) };
      const thread = await createThread(
        {
          role: "worker",
          storyId: "ROW-01",
          stage: "DEVELOP",
          attemptNumber: i + 1,
          cwd: project.paths.root,
          ownerToken: "owner",
          model: { provider: "anthropic", modelId: "claude" },
        },
        ctx,
      );
      ids[status] = thread.id;
      if (status === "pending") continue;
      const resumable = status === "interrupted";
      await transitionThread(
        thread.id,
        {
          expectedRevision: 1,
          status,
          patch: {
            resumable,
            session: { id: thread.id, file: `sessions/${thread.id}/history.jsonl` },
            ...(status === "failed" ? { error: { class: "quota", code: "QUOTA", message: "Quota reached" } } : {}),
            ...(status === "completed"
              ? { result: { outcome: "ready", summary: "Added the login page", blockers: [], problems: [] } }
              : {}),
          },
        },
        ctx,
      );
    }
    await createThread(
      { role: "worker", storyId: "ROW-02", stage: "DEVELOP", cwd: project.paths.root, ownerToken: "owner" },
      project.ctx,
    );
  });

  async function open(width = 120, height?: number) {
    const onEditing = vi.fn();
    const onCount = vi.fn();
    const tui = await renderTui(
      <LayoutContext.Provider value={{ width, height }}>
        <ThreadsTab
          ctx={project.ctx}
          storyId="ROW-01"
          stages={{ DEVELOP: "Develop" }}
          selected
          onCount={onCount}
          onEditing={onEditing}
          onHints={() => {}}
        />
      </LayoutContext.Provider>,
    );
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("Threads");
      expect(onCount).toHaveBeenCalledWith(6);
    });
    return { tui, onEditing };
  }

  it("lists the threads of the Story in every status, active first and then the newest", async () => {
    const { tui } = await open();
    const frame = tui.frame();
    const order = ["· pending", "▶ running", "! interrupted", "✕ cancelled", "✕ failed", "✓ completed"].map((s) =>
      frame.indexOf(s),
    );
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(frame).toContain("Quota reached");
    expect(frame).toContain("ready: Added the login page");
    expect(frame).toContain("anthropic/claude");
  });

  it("opens the selected thread with enter, and goes back with esc", async () => {
    const { tui, onEditing } = await open();
    await tui.press(keys.down, keys.enter);
    expect(onEditing).toHaveBeenLastCalledWith(true);
    expect(tui.frame()).toContain("ROW-01 › #5 Develop");
    expect(tui.frame()).toMatch(/Status\s+▶ running/);
    await tui.press(keys.escape);
    expect(onEditing).toHaveBeenLastCalledWith(false);
  });

  it("shows the list and the thread in turns in a narrow Modal", async () => {
    const { tui } = await open(60);
    expect(tui.frame()).toContain("pending");
    expect(tui.frame()).not.toContain("Status");
    await tui.press(keys.enter);
    expect(tui.frame()).toMatch(/Status\s+· pending/);
    expect(tui.frame()).not.toContain("▶ running");
    await tui.press(keys.escape);
    expect(tui.frame()).toContain("▶ running");
  });

  it("interrupts an active thread after a confirmation, and resumes an interrupted thread", async () => {
    const { tui } = await open();
    await tui.press("r");
    expect(factory.sendFactoryCommand).not.toHaveBeenCalled();
    await tui.press("x");
    expect(tui.frame()).toContain("Interrupt #6 Develop?");
    await tui.press("y");
    await vi.waitFor(() =>
      expect(factory.sendFactoryCommand).toHaveBeenCalledWith("cancel", { threadId: ids.pending }, project.ctx),
    );
    await tui.press(keys.down, keys.down);
    await tui.press("x");
    expect(tui.frame()).not.toContain("Interrupt #");
    await tui.press("r");
    await vi.waitFor(() =>
      expect(factory.sendFactoryCommand).toHaveBeenCalledWith("resume", { threadId: ids.interrupted }, project.ctx),
    );
    await vi.waitFor(() => expect(tui.toasts.list().map((t) => t.message)).toContain("Resumed ROW-01 #4 Develop"));
  });

  it("shows a change from the factory without a reload", async () => {
    const { tui } = await open();
    const running = ids.running as string;
    await transitionThread(running, { expectedRevision: 2, status: "completed" }, project.ctx);
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).not.toContain("▶ running");
    });
    expect(tui.frame()).not.toContain("Loading");
  });

  it("says when the Story waits for a worker slot", async () => {
    vi.mocked(factory.getFactoryStatus).mockResolvedValue({
      version: 1,
      phase: "ready",
      liveness: "alive",
      queue: [{ story: "ROW-01", stage: "DEVELOP", action: "skip", reason: "worker limit" }],
    } as FactoryStatus);
    const { tui } = await open();
    await settle(20);
    expect(tui.frame()).toContain("Waiting for a worker slot");
  });
});
