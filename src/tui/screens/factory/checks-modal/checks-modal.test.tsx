import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FactoryStatus } from "../../../../services/factory/factory.js";
import { LayoutContext } from "../../../hooks/index.js";
import { keys, renderTui } from "../../../testing/index.js";
import { ChecksModal } from "./checks-modal.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

type Job = NonNullable<FactoryStatus["checks"]>["jobs"][number];

const NOW = Date.parse("2026-05-01T12:00:00Z");
const STAGES = { IN_DEVELOPMENT: "In Development", IN_REVIEW: "In Review" };

function job(id: string, change: Partial<Job> = {}): Job {
  return {
    id,
    threadId: `t-${id}`,
    storyId: "ROW-01",
    stage: "IN_DEVELOPMENT",
    key: "test",
    scope: "full",
    status: "queued",
    queuedAt: "2026-05-01T11:59:00Z",
    ...change,
  };
}

function status(jobs: readonly Job[]): FactoryStatus {
  const running = jobs.filter((j) => j.status === "running").length;

  return {
    version: 1,
    phase: "ready",
    liveness: "alive",
    checks: { running, queued: jobs.length - running, maxConcurrent: 2, availableMb: 4096, jobs },
  } as FactoryStatus;
}

const JOBS = [
  job("q1", { storyId: "ROW-02", key: "lint", scope: "narrow" }),
  job("r1", { stage: "IN_REVIEW", status: "running", startedAt: "2026-05-01T11:58:56Z" }),
  job("q2", { storyId: "ROW-03", queuedAt: "2026-05-01T11:59:30Z" }),
];

function modal(value: FactoryStatus | undefined, onClose = () => {}) {
  return (
    <LayoutContext.Provider value={{ width: 100, height: undefined }}>
      <ChecksModal status={value} stages={STAGES} onClose={onClose} />
    </LayoutContext.Provider>
  );
}

describe("ChecksModal", () => {
  it("shows the summary line, then the running jobs and the queued jobs in the order of the queue", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const tui = await renderTui(modal(status(JOBS)));
    const frame = tui.frame();

    expect(frame).toContain("Factory › Checks");
    expect(frame).toContain("1 running · 2 queued · limit 2 · 4096 MB free");
    expect(frame).toContain("ROW-01 · In Review · test full · running · 1m 4s");
    expect(frame).toContain("ROW-02 · In Development · lint narrow · queued · 1m 0s");
    expect(frame).toContain("ROW-03 · In Development · test full · queued · 30s");
    expect(frame.indexOf("ROW-01")).toBeLessThan(frame.indexOf("ROW-02"));
    expect(frame.indexOf("ROW-02")).toBeLessThan(frame.indexOf("ROW-03"));
  });

  it("shows an empty-state text when the queue has no jobs", async () => {
    const tui = await renderTui(modal(status([])));

    expect(tui.frame()).toContain("0 running · 0 queued");
    expect(tui.frame()).toContain("No checks run or wait.");
  });

  it("shows new rows when the factory status changes", async () => {
    const tui = await renderTui(modal(status([job("a")])));
    expect(tui.frame()).not.toContain("ROW-09");

    await tui.rerender(modal(status([job("a"), job("b", { storyId: "ROW-09" })])));

    expect(tui.frame()).toContain("ROW-09");
    expect(tui.frame()).toContain("0 running · 2 queued");
  });

  it("moves the selection with ↑/↓ in a long list", async () => {
    const many = Array.from({ length: 12 }, (_, i) => job(`j${i}`, { storyId: `ROW-${String(i + 10)}` }));
    // Without a height, the list shows 11 rows.
    const tui = await renderTui(modal(status(many)));

    expect(tui.frame()).toContain("1/12");
    expect(tui.frame()).not.toContain("ROW-21");

    for (let i = 0; i < 11; i++) {
      await tui.press(keys.down);
    }

    expect(tui.frame()).toContain("12/12");
    expect(tui.frame()).toContain("ROW-21");
    await tui.press(keys.up);
    expect(tui.frame()).toContain("11/12");
  });

  it("closes on esc and on the ✕", async () => {
    const onClose = vi.fn();
    const tui = await renderTui(modal(status(JOBS), onClose));

    await tui.press(keys.escape);
    await tui.click("✕");

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
