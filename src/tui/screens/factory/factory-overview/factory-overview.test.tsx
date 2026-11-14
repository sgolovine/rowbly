import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FactoryStatus } from "../../../../services/factory/factory.js";
import { renderTui } from "../../../testing/index.js";
import { FactoryOverview, type FactoryOverviewProps } from "./factory-overview.js";

afterEach(cleanup);

const running = {
  version: 1,
  phase: "ready",
  liveness: "alive",
  responsive: true,
  workers: { running: 1, pending: 0, waiting: 0, limit: 2 },
  attention: [["commit", { text: "Canonical commit: failed" }]],
  queue: [{ story: "ROW-02", stage: "DEVELOP", action: "skip", reason: "worker limit" }],
} as unknown as FactoryStatus;

function props(overrides: Partial<FactoryOverviewProps> = {}): FactoryOverviewProps {
  return {
    status: { version: 1, phase: "stopped" } as FactoryStatus,
    live: false,
    supervisor: undefined,
    limit: 4,
    provider: undefined,
    canLaunch: true,
    aiSettings: true,
    stages: { DEVELOP: "Develop" },
    ...overrides,
  };
}

describe("FactoryOverview", () => {
  it("shows a stopped factory with its limit and the sign-in notice", async () => {
    const tui = await renderTui(<FactoryOverview {...props({ provider: false })} />);

    expect(tui.frame()).toContain("Stopped");
    expect(tui.frame()).toContain("limit 4");
    expect(tui.frame()).toContain("Press a to sign in");
  });

  it("tells how to start a factory that the Modal cannot start", async () => {
    const tui = await renderTui(<FactoryOverview {...props({ canLaunch: false })} />);

    expect(tui.frame()).toContain("Run rowbly factory start");
  });

  it("shows the workers, the problems and the queue of a live factory", async () => {
    const tui = await renderTui(<FactoryOverview {...props({ status: running, live: true })} />);

    expect(tui.frame()).toContain("Running");
    expect(tui.frame()).toContain("1 running · 0 pending · limit 2");
    expect(tui.frame()).toContain("Pi default");
    expect(tui.frame()).toContain("Canonical commit: failed");
    expect(tui.frame()).toContain("ROW-02 Develop · waiting for a worker slot");
    expect(tui.frame()).not.toContain("Checks");
  });

  it("shows the running and queued checks of a live factory with checks", async () => {
    const status = { ...running, checks: { running: 1, queued: 2, maxConcurrent: 1, availableMb: 900, jobs: [] } };
    const tui = await renderTui(<FactoryOverview {...props({ status, live: true })} />);

    expect(tui.frame()).toMatch(/Checks\s+1 running · 2 queued · limit 1 · 900 MB free/);
  });

  it("selects a warning with the first click and opens it with a click on the selected row", async () => {
    const onProblem = vi.fn();
    const tui = await renderTui(
      <FactoryOverview {...props({ status: running, live: true, clickable: true, onProblem })} />,
    );

    expect(tui.frame()).not.toContain("▌");

    await tui.click("Canonical commit");

    expect(onProblem).not.toHaveBeenCalled();
    expect(tui.frame()).toContain("▌ ! Canonical commit: failed");

    await tui.click("Canonical commit");

    expect(onProblem).toHaveBeenCalledOnce();
    expect(onProblem).toHaveBeenCalledWith("attention:commit");
  });

  it("moves the selection to a different warning without opening it", async () => {
    const two = {
      ...running,
      attention: [
        ["commit", { text: "Canonical commit: failed" }],
        ["push", { text: "Push: rejected" }],
      ],
    } as unknown as FactoryStatus;
    const onProblem = vi.fn();
    const tui = await renderTui(
      <FactoryOverview {...props({ status: two, live: true, clickable: true, onProblem })} />,
    );

    await tui.click("Canonical commit");
    await tui.click("Push: rejected");

    expect(onProblem).not.toHaveBeenCalled();
    expect(tui.frame()).toContain("▌ ! Push: rejected");
    expect(tui.frame()).not.toContain("▌ ! Canonical commit");
  });

  it("keeps no selection when the selected warning goes away", async () => {
    const onProblem = vi.fn();
    const tui = await renderTui(
      <FactoryOverview {...props({ status: running, live: true, clickable: true, onProblem })} />,
    );

    await tui.click("Canonical commit");
    await tui.rerender(
      <FactoryOverview {...props({ status: { ...running, attention: [] }, live: true, clickable: true, onProblem })} />,
    );

    expect(tui.frame()).not.toContain("Canonical commit");
    expect(tui.frame()).not.toContain("▌");

    await tui.rerender(<FactoryOverview {...props({ status: running, live: true, clickable: true, onProblem })} />);

    expect(tui.frame()).not.toContain("▌");

    await tui.click("Canonical commit");

    expect(onProblem).not.toHaveBeenCalled();
  });
});
