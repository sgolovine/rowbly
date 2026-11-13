import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadRecord } from "../../../../services/thread/thread.js";
import { keys, renderTui } from "../../../testing/index.js";
import { FactoryHistory } from "./factory-history.js";

afterEach(cleanup);

const threads = [
  { id: "old", createdAt: "2026-11-01T10:00:00.000Z", status: "completed" },
  { id: "new", createdAt: "2026-11-02T10:00:00.000Z", status: "running", model: { provider: "p", modelId: "m" } },
] as ThreadRecord[];

describe("FactoryHistory", () => {
  it("lists the newest supervisor first and picks the highlighted one with enter", async () => {
    const onPick = vi.fn();
    const tui = await renderTui(
      <FactoryHistory
        threads={threads}
        supervisorId="new"
        height={30}
        active
        onFilteringChange={vi.fn()}
        onPick={onPick}
      />,
    );

    expect(tui.frame().indexOf("running")).toBeLessThan(tui.frame().indexOf("completed"));
    expect(tui.frame()).toContain("p/m");
    expect(tui.frame()).toContain("Pi default");

    await tui.press(keys.down);
    await tui.press(keys.enter);

    expect(onPick).toHaveBeenCalledWith("old");
  });

  it("tells when there is no history", async () => {
    const tui = await renderTui(
      <FactoryHistory
        threads={[]}
        supervisorId={undefined}
        height={undefined}
        active
        onFilteringChange={vi.fn()}
        onPick={vi.fn()}
      />,
    );

    expect(tui.frame()).toContain("No supervisor history");
  });
});
