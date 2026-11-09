import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keys, renderTui } from "../../testing/index.js";
import { type SelectItem, SelectList, type SelectListProps } from "./SelectList.js";

afterEach(cleanup);

const ITEMS: SelectItem[] = [
  { value: "a", label: "Alpha", description: "first" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" },
];

function setup(props: Partial<SelectListProps<string>> = {}) {
  const onSelect = vi.fn();
  const tui = renderTui(<SelectList items={ITEMS} onSelect={onSelect} {...props} />);
  return { tui, onSelect };
}

describe("SelectList", () => {
  it("shows the labels and descriptions, with the first item highlighted", async () => {
    const frame = (await setup().tui).frame();
    expect(frame).toContain("▌ Alpha first");
    expect(frame).toContain("  Beta");
  });

  it("starts on defaultIndex and shows a tag after the label", async () => {
    const items: SelectItem[] = [ITEMS[0] as SelectItem, { value: "b", label: "Beta", tag: " · current" }];
    const frame = (await setup({ items, defaultIndex: 1 }).tui).frame();
    expect(frame).toContain("▌ Beta · current");
  });

  it("moves with ↑/↓ and j/k, reports the highlight, and picks on enter", async () => {
    const onHighlight = vi.fn();
    const { tui, onSelect } = setup({ onHighlight });
    const t = await tui;
    expect(onHighlight).toHaveBeenLastCalledWith(ITEMS[0]);
    await t.press("j", keys.down, keys.down, "k");
    expect(onHighlight).toHaveBeenLastCalledWith(ITEMS[1]);
    expect(t.frame()).toContain("▌ Beta");
    await t.press(keys.enter);
    expect(onSelect).toHaveBeenCalledWith(ITEMS[1]);
  });

  it("filters by label after /, and esc clears the filter", async () => {
    const t = await setup().tui;
    await t.type("/et");
    expect(t.frame()).toContain("/et");
    expect(t.frame()).toContain("Beta");
    expect(t.frame()).not.toContain("Alpha");
    await t.press(keys.escape);
    expect(t.frame()).toContain("Alpha");
    expect(t.frame()).not.toContain("/et");
  });

  it("keeps the filter after enter and explains no matches", async () => {
    const { tui, onSelect } = setup();
    const t = await tui;
    await t.type("/zz");
    await t.press(keys.enter);
    expect(t.frame()).toContain('No matches for "zz".');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("picks a clicked item", async () => {
    const { tui, onSelect } = setup();
    await (await tui).click("Gamma");
    expect(onSelect).toHaveBeenCalledWith(ITEMS[2]);
  });

  it("toggles with space and submits the checked values on enter in multi mode", async () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    const t = await setup({ multi: true, defaultSelected: ["c"], onChange, onSubmit }).tui;
    expect(t.frame()).toContain("[x] Gamma");
    await t.press(keys.space, keys.down, keys.down, keys.space);
    expect(onChange).toHaveBeenLastCalledWith(["a"]);
    expect(t.frame()).toContain("[x] Alpha");
    expect(t.frame()).toContain("[ ] Gamma");
    await t.press(keys.enter);
    expect(onSubmit).toHaveBeenCalledWith(["a"]);
  });

  it("shows emptyText without items", async () => {
    expect((await setup({ items: [], emptyText: "No stories yet." }).tui).frame()).toContain("No stories yet.");
  });

  it("shows only limit rows and the position", async () => {
    const t = await setup({ limit: 2 }).tui;
    expect(t.frame()).toContain("1/3");
    expect(t.frame()).not.toContain("Gamma");
    await t.press(keys.down, keys.down);
    expect(t.frame()).toContain("3/3");
    expect(t.frame()).toContain("Gamma");
    expect(t.frame()).not.toContain("Alpha");
  });

  it("takes no keys while not active", async () => {
    const { tui, onSelect } = setup({ isActive: false });
    const t = await tui;
    await t.press(keys.down, keys.enter);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
