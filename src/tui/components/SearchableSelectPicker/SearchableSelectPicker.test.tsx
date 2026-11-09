import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keys, renderTui } from "../../testing/index.js";
import { SearchableSelectPicker } from "./SearchableSelectPicker.js";

afterEach(cleanup);

const OPTIONS = ["BACKLOG", "DOING", "DONE"];
const LABELS = { BACKLOG: "Backlog", DOING: "In progress", DONE: "Done" };

function setup(props: Partial<Parameters<typeof SearchableSelectPicker>[0]> = {}) {
  const onSelect = vi.fn();
  const onCancel = vi.fn();
  const tui = renderTui(
    <SearchableSelectPicker
      options={OPTIONS}
      labels={LABELS}
      initialQuery=""
      value={null}
      onSelect={onSelect}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { tui, onSelect, onCancel };
}

describe("SearchableSelectPicker", () => {
  it("shows the query placeholder, the selected value and every option", async () => {
    const frame = (await setup({ value: "DONE" }).tui).frame();
    expect(frame).toContain("Type to search…");
    expect(frame).toContain("Selected: Done");
    for (const label of Object.values(LABELS)) expect(frame).toContain(label);
  });

  it("starts at the current value and moves with ↑/↓; enter selects", async () => {
    const { tui, onSelect } = setup({ value: "DOING" });
    const t = await tui;
    expect(t.frame()).toContain("▌ In progress");
    await t.press(keys.down, keys.down, keys.up, keys.enter);
    expect(onSelect).toHaveBeenCalledWith("DOING");
  });

  it("filters by the option value and label", async () => {
    const { tui, onSelect } = setup();
    const t = await tui;
    await t.type("progress");
    expect(t.frame()).toContain("In progress");
    expect(t.frame()).not.toContain("Backlog");
    await t.press(keys.enter);
    expect(onSelect).toHaveBeenCalledWith("DOING");
  });

  it("clears the query on ctrl+l", async () => {
    const t = await setup({ initialQuery: "back" }).tui;
    expect(t.frame()).not.toContain("Done");
    await t.press(keys.ctrl("l"));
    expect(t.frame()).toContain("Done");
    expect(t.frame()).toContain("Type to search…");
  });

  it("cancels on esc", async () => {
    const { tui, onCancel, onSelect } = setup();
    await (await tui).press(keys.escape);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("explains an empty list", async () => {
    const { tui, onSelect } = setup({ initialQuery: "zzz" });
    const t = await tui;
    expect(t.frame()).toContain("No matching choices.");
    await t.press(keys.enter);
    expect(onSelect).not.toHaveBeenCalled();
    expect((await setup({ options: [] }).tui).frame()).toContain("No choices available.");
  });

  it("shows the position when the results do not fit", async () => {
    const options = Array.from({ length: 12 }, (_, i) => `opt${i + 1}`);
    const t = await setup({ options, labels: undefined }).tui;
    expect(t.frame()).toContain("1/12");
    expect(t.frame()).not.toContain("opt12");
    await t.press(keys.up, ...Array(11).fill(keys.down));
    expect(t.frame()).toContain("12/12");
    expect(t.frame()).toContain("opt12");
  });

  it("selects a clicked option", async () => {
    const { tui, onSelect } = setup();
    await (await tui).click("Done");
    expect(onSelect).toHaveBeenCalledWith("DONE");
  });
});
