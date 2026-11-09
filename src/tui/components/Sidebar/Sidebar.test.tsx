import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../testing/index.js";
import { SIDEBAR_MIN_WIDTH } from "../shellLayout.js";
import { Sidebar } from "./Sidebar.js";

afterEach(cleanup);

const entries = [
  { id: "web", label: "Web" },
  { id: "api", label: "API" },
];

function setup(props: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  const handlers = {
    onResize: vi.fn(),
    onFocus: vi.fn(),
    onSelect: vi.fn(),
    onNew: vi.fn(),
  };
  const tui = renderTui(
    <Sidebar
      title="Boards"
      entries={entries}
      current={0}
      numbered
      width={22}
      maxWidth={40}
      focused={false}
      clickable
      onResize={handlers.onResize}
      onFocus={handlers.onFocus}
      onSelect={handlers.onSelect}
      button={{ label: "+ New board", onClick: handlers.onNew }}
      {...props}
    />,
  );
  return { ...handlers, tui };
}

describe("Sidebar", () => {
  it("shows the title, the entries with their keys and the button", async () => {
    const frame = (await setup().tui).frame();
    expect(frame).toContain("╭─Boards");
    expect(frame).toMatch(/▌ Web\s+1/);
    expect(frame).toMatch(/ {2}API\s+2/);
    expect(frame).toContain("+ New board");
    expect(frame).not.toContain(" n ");
  });

  it("shows the empty text without entries, and the n key on the button while focused", async () => {
    const frame = (await setup({ entries: [], emptyText: "No boards yet", focused: true }).tui).frame();
    expect(frame).toContain("No boards yet");
    expect(frame).toMatch(/\+ New board\s+n/);
  });

  it("focuses and selects on a click on an entry", async () => {
    const { tui, onFocus, onSelect } = setup();
    const t = await tui;
    await t.click("API");
    expect(onSelect).toHaveBeenCalledWith("api");
    expect(onFocus).toHaveBeenCalledOnce();
  });

  it("focuses on a click in the empty part of the panel, and runs the button on a click", async () => {
    const { tui, onFocus, onSelect, onNew } = setup();
    const t = await tui;
    const at = t.locate("╭─Boards");
    await t.mouse("press", at.x + 2, at.y);
    await t.mouse("release", at.x + 2, at.y);
    expect(onFocus).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
    await t.click("+ New board");
    expect(onNew).toHaveBeenCalledOnce();
  });

  it.each([
    ["without a height", {}],
    ["with a height", { height: 10 }],
  ])("resizes on a pull of the right edge %s, between the minimum and maxWidth", async (_, props) => {
    const { tui, onResize } = setup(props);
    const t = await tui;
    await t.mouse("press", 21, 1);
    await t.mouse("move", 29, 1);
    await t.mouse("move", 2, 1);
    await t.mouse("move", 70, 1);
    await t.mouse("release", 70, 1);
    expect(onResize.mock.calls).toEqual([[30], [SIDEBAR_MIN_WIDTH], [40]]);
  });

  it.each([
    ["without a height", {}, 5],
    ["with a height", { height: 10 }, 10],
  ])("can be pulled from the bottom row of its border %s", async (_, props, rows) => {
    const { tui, onResize } = setup(props);
    const t = await tui;
    const lines = t.frame().split("\n");
    expect(lines[rows - 1]).toMatch(/^╰─+╯/);
    expect(lines[rows]?.trim() ?? "").toBe("");
    await t.mouse("press", 21, rows - 1);
    await t.mouse("move", 25, rows - 1);
    await t.mouse("release", 25, rows - 1);
    expect(onResize.mock.calls).toEqual([[26]]);
  });

  it("ignores the mouse while not clickable", async () => {
    const { tui, onFocus, onSelect, onResize, onNew } = setup({ clickable: false });
    const t = await tui;
    await t.click("API");
    await t.click("+ New board");
    await t.mouse("press", 21, 1);
    await t.mouse("move", 29, 1);
    await t.mouse("release", 29, 1);
    expect(onFocus).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onResize).not.toHaveBeenCalled();
    expect(onNew).not.toHaveBeenCalled();
  });

  it("shows a ✎ on editable entries only, and a click on it focuses the sidebar and edits the entry", async () => {
    const onEdit = vi.fn();
    const { tui, onFocus, onSelect } = setup({
      numbered: false,
      entries: [
        { id: "all", label: "All" },
        { id: "api", label: "API", editable: true },
      ],
      onEdit,
    });
    const t = await tui;
    expect(t.frame()).not.toMatch(/All\s+✎/);
    expect(t.frame()).toMatch(/API\s+✎/);
    await t.click("✎");
    expect(onEdit).toHaveBeenCalledWith("api");
    expect(onFocus).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("moves a movable entry when it is dropped on another row", async () => {
    const onMove = vi.fn();
    const movable = entries.map((entry) => ({ ...entry, movable: true }));
    const { tui, onFocus, onSelect } = setup({ entries: movable, onMove });
    const t = await tui;
    const web = t.locate("Web");
    const api = t.locate("API");
    await t.mouse("press", web.x, web.y);
    await t.mouse("move", api.x, api.y);
    expect(t.frame()).toMatch(/› API/);
    await t.mouse("release", api.x, api.y);
    expect(onMove).toHaveBeenCalledWith("web", 1);
    expect(onFocus).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(t.frame()).not.toContain("›");
  });

  it("does not drag an entry that is not movable", async () => {
    const onMove = vi.fn();
    const { tui } = setup({ onMove });
    const t = await tui;
    const web = t.locate("Web");
    const api = t.locate("API");
    await t.mouse("press", web.x, web.y);
    await t.mouse("move", api.x, api.y);
    await t.mouse("release", api.x, api.y);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("shows the entries around the current one when the height is too small for all of them", async () => {
    const many = ["a", "b", "c", "d", "e", "f", "g"].map((id) => ({ id, label: `Entry ${id}` }));
    const frame = (await setup({ entries: many, current: 3, height: 8, numbered: false }).tui).frame();
    expect(frame).toContain("↑ 2 more");
    expect(frame).toMatch(/▌ Entry d/);
    expect(frame).toContain("↓ 2 more");
    expect(frame).not.toContain("Entry a");
    expect(frame).not.toContain("Entry g");
  });

  it("does not drag its edge without onResize", async () => {
    const { tui, onResize } = setup({ onResize: undefined });
    const t = await tui;
    await t.mouse("press", 21, 1);
    await t.mouse("move", 30, 1);
    await t.mouse("release", 30, 1);
    expect(onResize).not.toHaveBeenCalled();
  });
});
