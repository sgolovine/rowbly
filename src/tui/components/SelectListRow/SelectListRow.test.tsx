import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../testing/index.js";
import { SelectListRow } from "./SelectListRow.js";

afterEach(cleanup);

describe("SelectListRow", () => {
  it("shows the marker only when highlighted", async () => {
    const tui = await renderTui(
      <SelectListRow highlighted active>
        ROW-1
      </SelectListRow>,
    );
    expect(tui.frame()).toBe("▌ ROW-1");
    await tui.rerender(
      <SelectListRow highlighted={false} active>
        ROW-1
      </SelectListRow>,
    );
    expect(tui.frame()).toBe("  ROW-1");
  });

  it("calls onClick on a click", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(
      <SelectListRow highlighted={false} active onClick={onClick}>
        ROW-1
      </SelectListRow>,
    );
    await tui.click("ROW-1");
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("ignores the mouse while not active", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(
      <SelectListRow highlighted={false} active={false} onClick={onClick}>
        ROW-1
      </SelectListRow>,
    );
    await tui.click("ROW-1");
    expect(onClick).not.toHaveBeenCalled();
  });
});
