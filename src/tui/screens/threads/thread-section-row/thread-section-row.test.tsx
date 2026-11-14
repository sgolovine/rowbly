import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../../testing/index.js";
import { ThreadSectionRow } from "./thread-section-row.js";

afterEach(cleanup);

describe("ThreadSectionRow", () => {
  it("shows the glyph, the name and the count of an expanded section", async () => {
    const tui = await renderTui(
      <ThreadSectionRow label="Active Threads" count={2} collapsed={false} selected clickable onClick={() => {}} />,
    );
    expect(tui.frame()).toContain("▌ ▾ Active Threads (2)");
  });

  it("shows ▸ for a collapsed section, and No Threads for an empty expanded section", async () => {
    const tui = await renderTui(
      <ThreadSectionRow label="Active Threads" count={0} collapsed selected={false} clickable onClick={() => {}} />,
    );
    expect(tui.frame()).toContain("▸ Active Threads (0)");
    expect(tui.frame()).not.toContain("No Threads");
    await tui.rerender(
      <ThreadSectionRow
        label="Active Threads"
        count={0}
        collapsed={false}
        selected={false}
        clickable
        onClick={() => {}}
      />,
    );
    expect(tui.frame()).toContain("▾ Active Threads (0)  No Threads");
  });

  it("calls onClick on a click", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(
      <ThreadSectionRow
        label="Inactive Threads"
        count={1}
        collapsed={false}
        selected={false}
        clickable
        onClick={onClick}
      />,
    );
    await tui.click("Inactive Threads");
    expect(onClick).toHaveBeenCalledOnce();
  });
});
