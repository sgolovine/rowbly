import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../../testing/index.js";
import { StageHeadingRow } from "./stage-heading-row.js";

afterEach(cleanup);

describe("StageHeadingRow", () => {
  it("shows the arrow, the Stage name and the count, with the bar when selected", async () => {
    const tui = await renderTui(
      <StageHeadingRow label="Backlog" count={3} collapsed={false} selected clickable onClick={() => {}} />,
    );
    expect(tui.frame()).toMatch(/^▌ ▾ Backlog \(3\)\s*$/);
    await tui.rerender(
      <StageHeadingRow label="Backlog" count={3} collapsed selected={false} clickable onClick={() => {}} />,
    );
    expect(tui.frame()).toMatch(/^ {2}▸ Backlog \(3\)\s*$/);
  });

  it("says that an expanded Stage has no Stories", async () => {
    const tui = await renderTui(
      <StageHeadingRow label="Done" count={0} collapsed={false} selected={false} clickable onClick={() => {}} />,
    );
    expect(tui.frame()).toContain("▾ Done (0)  No Stories");
  });

  it("calls onClick on a click", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(
      <StageHeadingRow label="Done" count={1} collapsed={false} selected={false} clickable onClick={onClick} />,
    );
    await tui.click("Done");
    expect(onClick).toHaveBeenCalledOnce();
  });
});
