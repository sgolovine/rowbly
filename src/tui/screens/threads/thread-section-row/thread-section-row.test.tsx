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

  it("puts one empty line above a spaced heading, outside the highlight", async () => {
    const tui = await renderTui(
      <ThreadSectionRow
        label="Inactive Threads"
        count={1}
        collapsed={false}
        selected
        clickable
        spaced
        onClick={() => {}}
      />,
    );
    const lines = tui.frame().split("\n");
    const at = lines.findIndex((line) => line.includes("Inactive Threads"));
    expect(at).toBe(1);
    expect(lines[0]?.trim()).toBe("");
    expect(lines[1]).toContain("▌ ▾ Inactive Threads (1)");
  });

  it("puts no empty line above a heading that is not spaced", async () => {
    const tui = await renderTui(
      <ThreadSectionRow label="Active Threads" count={1} collapsed={false} selected clickable onClick={() => {}} />,
    );
    expect(tui.frame().split("\n")[0]).toContain("Active Threads");
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
