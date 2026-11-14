import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FactoryStatus } from "../../../../services/factory/factory.js";
import { renderTui } from "../../../testing/index.js";
import type { FactoryModalModel } from "../factory-modal/use-factory-modal.js";
import { FactoryMain } from "./factory-main.js";

afterEach(cleanup);

const running = {
  version: 1,
  phase: "ready",
  liveness: "alive",
  responsive: true,
  workers: { running: 1, pending: 0, waiting: 0, limit: 2 },
  attention: [["commit", { text: "Canonical commit: failed" }]],
} as unknown as FactoryStatus;

function model(): FactoryModalModel {
  return {
    live: true,
    idle: true,
    busy: null,
    supervisor: undefined,
    limit: 2,
    provider: undefined,
    can: { start: false, stop: true, inspect: false, warnings: true },
    actions: { start: vi.fn(), openSupervisor: vi.fn(), openHistory: vi.fn(), askStop: vi.fn() },
    attention: { actions: { pick: vi.fn(), openList: vi.fn() } },
  } as unknown as FactoryModalModel;
}

describe("FactoryMain", () => {
  it("shows the overview and the buttons, and opens a warning with a second click on its row", async () => {
    const m = model();
    const tui = await renderTui(
      <FactoryMain model={m} status={running} canLaunch stages={{}} onAiSettings={undefined} />,
    );

    expect(tui.frame()).toContain("Running");
    expect(tui.frame()).toContain("Warnings");

    await tui.click("Canonical commit");

    expect(m.attention.actions.pick).not.toHaveBeenCalled();

    await tui.click("Canonical commit");

    expect(m.attention.actions.pick).toHaveBeenCalledWith("attention:commit");

    await tui.click("Warnings");

    expect(m.attention.actions.openList).toHaveBeenCalledOnce();
  });
});
