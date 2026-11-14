import { cleanup } from "ink-testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestProject } from "../../../../services/test-project/test-project.js";
import {
  createThread,
  type ThreadRecord,
  type ThreadStatus,
  transitionThread,
} from "../../../../services/thread/thread.js";
import { LayoutContext } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { keys, renderTui } from "../../../testing/index.js";
import { FactoryView } from "./factory-view.js";

vi.mock("@earendil-works/pi-coding-agent", () => {
  throw new Error("The Factory view must not load Pi");
});

afterEach(cleanup);

const STAGES = { DEVELOP: "Develop", REVIEW: "Review" };

describe("FactoryView", () => {
  const project = useTestProject();
  const ids: Partial<Record<ThreadStatus, string>> = {};

  /** One worker Thread in each status, one minute apart, oldest first, and one supervisor Thread. */
  async function seed() {
    const statuses: ThreadStatus[] = ["completed", "failed", "cancelled", "interrupted", "running", "pending"];
    for (const [i, status] of statuses.entries()) {
      const ctx = { ...project.ctx, now: () => new Date(Date.UTC(2026, 10, 12, 10, i)) };
      const thread = await createThread(
        {
          role: "worker",
          storyId: `ROW-0${i + 1}`,
          stage: status === "completed" ? "REVIEW" : "DEVELOP",
          attemptNumber: 1,
          cwd: project.paths.root,
          ownerToken: "owner",
          model: { provider: "anthropic", modelId: "claude" },
        },
        ctx,
      );
      ids[status] = thread.id;
      if (status !== "pending") {
        await transitionThread(thread.id, { expectedRevision: 1, status }, ctx);
      }
    }
    await createThread({ role: "supervisor", cwd: project.paths.root, ownerToken: "owner" }, project.ctx);
  }

  async function open(props: { stage?: string; active?: boolean; clickable?: boolean; height?: number } = {}) {
    const onOpen = vi.fn<(thread: ThreadRecord) => void>();
    const onHints = vi.fn<(hints: readonly KeyHint[]) => void>();
    const view = (active: boolean) => (
      <LayoutContext.Provider value={{ width: 100, height: props.height }}>
        <FactoryView
          ctx={project.ctx}
          root={project.paths.root}
          stage={props.stage}
          stages={STAGES}
          active={active}
          clickable={props.clickable ?? true}
          emptyText="No Threads. The factory adds a Thread when it starts a worker."
          onOpen={onOpen}
          onHints={onHints}
        />
      </LayoutContext.Provider>
    );
    const tui = await renderTui(view(props.active ?? true));
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).not.toContain("Loading");
    });
    return { tui, onOpen, onHints, rerender: (active: boolean) => tui.rerender(view(active)) };
  }

  describe("with Threads", () => {
    beforeEach(seed);

    it("groups the worker Threads into Active and Inactive Threads, newest first, without the supervisor", async () => {
      const { tui } = await open();
      const frame = tui.frame();
      const order = [
        "▾ Active Threads (2)",
        "ROW-06 · pending",
        "ROW-05 ▶ running",
        "▾ Inactive Threads (4)",
        "ROW-04 ! interrupted",
        "ROW-03 ✕ cancelled",
        "ROW-02 ✕ failed",
        "ROW-01 ✓ completed",
      ].map((text) => frame.indexOf(text));
      expect(order.every((at) => at >= 0)).toBe(true);
      expect(order.toSorted((a, b) => a - b)).toEqual(order);
      expect(frame).not.toContain("Supervisor");
      expect(frame).toMatch(/ROW-05 ▶ running #1 Develop/);
      expect(frame).toContain("claude ·");
    });

    it("shows only the Threads of the selected Stage", async () => {
      const { tui } = await open({ stage: "REVIEW" });
      expect(tui.frame()).toContain("▾ Active Threads (0)  No Threads");
      expect(tui.frame()).toContain("▾ Inactive Threads (1)");
      expect(tui.frame()).toContain("ROW-01 ✓ completed #1 Review");
      expect(tui.frame()).not.toContain("ROW-02");
    });

    it("moves over the headings and the rows with ↑/↓ and j/k, and opens a Thread with enter", async () => {
      const { tui, onOpen } = await open();
      expect(tui.frame()).toContain("▌ ROW-06");
      await tui.press(keys.up);
      expect(tui.frame()).toContain("▌ ▾ Active Threads");
      await tui.press("j", "j", keys.down);
      expect(tui.frame()).toContain("▌ ▾ Inactive Threads");
      await tui.press("j", keys.enter);
      expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: ids.interrupted }));
      await tui.press("k");
      expect(tui.frame()).toContain("▌ ▾ Inactive Threads");
    });

    it("collapses and expands a section with enter, ←/→ and a click", async () => {
      const { tui, onHints } = await open();
      await tui.press(keys.up);
      expect(onHints).toHaveBeenLastCalledWith(expect.arrayContaining([{ key: "enter", description: "collapse" }]));
      await tui.press(keys.enter);
      expect(tui.frame()).toContain("▸ Active Threads (2)");
      expect(tui.frame()).not.toContain("ROW-06");
      await tui.press(keys.right);
      expect(tui.frame()).toContain("ROW-06");
      await tui.press(keys.left);
      expect(tui.frame()).not.toContain("ROW-06");
      await tui.press(keys.space);
      expect(tui.frame()).toContain("ROW-06");
      await tui.click("Inactive Threads");
      expect(tui.frame()).toContain("▸ Inactive Threads (4)");
      expect(tui.frame()).not.toContain("ROW-01");
      await tui.click("Inactive Threads");
      expect(tui.frame()).toContain("ROW-01");
    });

    it("collapses the section of a Thread with ← and selects its heading", async () => {
      const { tui } = await open();
      await tui.press(keys.left);
      expect(tui.frame()).toContain("▌ ▸ Active Threads (2)");
    });

    it("opens a Thread on a click", async () => {
      const { tui, onOpen } = await open();
      await tui.click("ROW-02");
      expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: ids.failed }));
      expect(tui.frame()).toContain("▌ ROW-02");
    });

    it("takes no keys while it is not active", async () => {
      const { tui, onOpen, rerender } = await open({ active: false });
      await rerender(false);
      await tui.press(keys.up, keys.enter);
      expect(tui.frame()).toContain("▌ ROW-06");
      expect(onOpen).not.toHaveBeenCalled();
    });

    describe("in a short Panel", () => {
      const position = (frame: string) => frame.match(/↑↓ \d+–\d+ of \d+/)?.[0];

      it("scrolls with the wheel while it is active", async () => {
        const { tui } = await open({ height: 4 });
        expect(position(tui.frame())).toBe("↑↓ 1–3 of 14");
        await tui.mouse("wheelDown", 1, 1);
        expect(position(tui.frame())).toBe("↑↓ 4–6 of 14");
        await tui.mouse("wheelUp", 1, 1);
        expect(position(tui.frame())).toBe("↑↓ 1–3 of 14");
      });

      it("scrolls with the wheel but not with pgdn while it is clickable and not active", async () => {
        const { tui, rerender } = await open({ height: 4, active: false });
        await rerender(false);
        await tui.press(keys.pageDown);
        expect(position(tui.frame())).toBe("↑↓ 1–3 of 14");
        await tui.mouse("wheelDown", 1, 1);
        expect(position(tui.frame())).toBe("↑↓ 4–6 of 14");
        await tui.mouse("wheelUp", 1, 1);
        expect(position(tui.frame())).toBe("↑↓ 1–3 of 14");
      });

      it("takes no wheel while it is not clickable", async () => {
        const { tui } = await open({ height: 4, active: false, clickable: false });
        await tui.mouse("wheelDown", 1, 1);
        expect(position(tui.frame())).toBe("↑↓ 1–3 of 14");
      });
    });

    it("shows a change of a Thread file without a reload", async () => {
      const { tui } = await open();
      await transitionThread(ids.running as string, { expectedRevision: 2, status: "completed" }, project.ctx);
      await vi.waitFor(async () => {
        await tui.press();
        expect(tui.frame()).toContain("▾ Active Threads (1)");
        expect(tui.frame()).toContain("▾ Inactive Threads (5)");
      });
      expect(tui.frame()).not.toContain("Loading");
    });
  });

  it("shows one faint line without Threads", async () => {
    const { tui } = await open();
    expect(tui.frame()).toContain("No Threads. The factory adds a Thread when it starts a worker.");
    expect(tui.frame()).not.toContain("Active Threads");
  });
});
