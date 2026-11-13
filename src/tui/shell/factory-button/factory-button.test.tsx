import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FactoryStatus } from "../../../services/factory/factory.js";
import { renderTui } from "../../testing/index.js";
import { FactoryButton, factoryButtonWidth } from "./factory-button.js";

afterEach(cleanup);

const ready = {
  version: 1,
  phase: "ready",
  liveness: "alive",
  responsive: true,
  workers: { running: 2, pending: 1, waiting: 0, limit: 4 },
  attention: [["commit", { text: "Canonical commit: failed" }]],
} as unknown as FactoryStatus;

describe("FactoryButton", () => {
  it("shows a stopped factory with its key", async () => {
    const tui = await renderTui(
      <FactoryButton status={{ version: 1, phase: "stopped" }} showKey onClick={() => {}} clickable />,
    );
    expect(tui.frame()).toMatch(/Factory off {2}f/);
  });

  it("shows the counts and the problems of a running factory, and its width matches", async () => {
    const tui = await renderTui(<FactoryButton status={ready} showKey={false} onClick={() => {}} clickable />);
    expect(tui.frame()).toContain("Factory 2/4 · 1 pending ! 1");
    // The padding takes one column on each side of the text.
    expect(tui.frame().trim().length + 2).toBe(factoryButtonWidth(ready, false));
  });

  it("calls onClick on a click", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(<FactoryButton status={undefined} showKey onClick={onClick} clickable />);
    await tui.click("Factory");
    expect(onClick).toHaveBeenCalledOnce();
  });
});
