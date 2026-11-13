import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../testing/index.js";
import { SidebarRow, type SidebarRowEnv } from "./sidebar-row.js";

afterEach(cleanup);

function testEnv(): SidebarRowEnv {
  return { self: {}, onFocus: vi.fn(), onSelect: vi.fn(), onEdit: vi.fn(), setOver: vi.fn() };
}

describe("SidebarRow", () => {
  it("shows the entry with its number key, and focuses and selects it on a click", async () => {
    const env = testEnv();
    const tui = await renderTui(
      <SidebarRow
        entry={{ id: "b1", label: "Board one" }}
        index={0}
        selected
        numbered
        clickable
        dropTarget={false}
        env={env}
      />,
    );

    expect(tui.frame()).toContain("▌ Board one");
    expect(tui.frame()).toContain("1");

    await tui.click("Board one");

    expect(env.onFocus).toHaveBeenCalled();
    expect(env.onSelect).toHaveBeenCalledWith("b1");
  });

  it("edits an editable entry with a click on its ✎", async () => {
    const env = testEnv();
    const tui = await renderTui(
      <SidebarRow
        entry={{ id: "b1", label: "Board", editable: true }}
        index={0}
        selected={false}
        numbered={false}
        clickable
        dropTarget
        env={env}
      />,
    );

    expect(tui.frame()).toContain("› Board");

    await tui.click("✎");

    expect(env.onEdit).toHaveBeenCalledWith("b1");
    expect(env.onSelect).not.toHaveBeenCalled();
  });
});
