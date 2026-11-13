import { Box } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../testing/index.js";
import { SidebarItem } from "./sidebar-item.js";

afterEach(cleanup);

/** The item in a sidebar-wide box, as a `Sidebar` draws it. */
const inSidebar = (node: React.ReactElement) => <Box width={20}>{node}</Box>;

describe("SidebarItem", () => {
  it("marks the selected entry and shows the 1-based key of a Board", async () => {
    const tui = await renderTui(inSidebar(<SidebarItem index={0} name="Web" selected clickable onClick={() => {}} />));
    expect(tui.frame()).toBe("▌ Web             1");
    await tui.rerender(inSidebar(<SidebarItem index={1} name="Web" selected={false} clickable onClick={() => {}} />));
    expect(tui.frame()).toBe("  Web             2");
  });

  it("shows no key past the ninth entry, and none without an index", async () => {
    const tui = await renderTui(
      inSidebar(<SidebarItem index={9} name="Ten" selected={false} clickable onClick={() => {}} />),
    );
    expect(tui.frame()).toBe("  Ten");
    await tui.rerender(inSidebar(<SidebarItem name="Notes" selected={false} clickable onClick={() => {}} />));
    expect(tui.frame()).toBe("  Notes");
  });

  it("keeps the marker column at two cells when the name is wider than the sidebar", async () => {
    const tui = await renderTui(
      <Box width={12}>
        <SidebarItem index={0} name={"A".repeat(40)} selected={false} clickable onClick={() => {}} onEdit={() => {}} />
      </Box>,
    );
    expect(tui.frame()).toMatch(/^ {2}A/);
  });

  it("calls onClick on a click", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(inSidebar(<SidebarItem name="Web" selected={false} clickable onClick={onClick} />));
    await tui.click("Web");
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("ignores the mouse while not clickable", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(
      inSidebar(<SidebarItem name="Web" selected={false} clickable={false} onClick={onClick} />),
    );
    await tui.click("Web");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("shows a ✎ with onEdit, and a click on it edits rather than selects", async () => {
    const onClick = vi.fn();
    const onEdit = vi.fn();
    const tui = await renderTui(
      inSidebar(<SidebarItem name="Backlog" selected={false} clickable onClick={onClick} onEdit={onEdit} />),
    );
    expect(tui.frame()).toMatch(/^ {2}Backlog\s+✎$/);
    await tui.click("✎");
    expect(onEdit).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("with drag, clicks on the release, and shows a › while a row is over it", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(
      inSidebar(<SidebarItem name="Backlog" selected clickable drag="BACKLOG" onClick={onClick} />),
    );
    await tui.mouse("press", 4, 0);
    expect(onClick).not.toHaveBeenCalled();
    await tui.mouse("release", 4, 0);
    expect(onClick).toHaveBeenCalledOnce();
    await tui.rerender(inSidebar(<SidebarItem name="Backlog" selected clickable dropTarget onClick={onClick} />));
    expect(tui.frame()).toMatch(/^› Backlog/);
  });
});
