import { cleanup } from "ink-testing-library";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keys, renderTui, settle } from "../../testing/index.js";
import type { FormField } from "../form/index.js";
import { SearchableSelect } from "./searchable-select.js";

afterEach(cleanup);

const FIELD: FormField = {
  name: "stage",
  label: "Stage",
  kind: "select",
  searchable: true,
  options: ["BACKLOG", "DOING", "DONE"],
  optionLabels: { BACKLOG: "Backlog", DOING: "In progress", DONE: "Done" },
};

function Controlled({ onChange, focused = true }: { onChange(value: string): void; focused?: boolean }) {
  const [value, setValue] = useState<string | null>("BACKLOG");
  return (
    <SearchableSelect
      field={FIELD}
      value={value}
      focused={focused}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

/** Presses `input`, then waits for the picker overlay to open and take keys. */
async function open(tui: Awaited<ReturnType<typeof renderTui>>, input: string) {
  await tui.press(input);
  await settle(30);
}

describe("SearchableSelect", () => {
  it("shows the label of the value", async () => {
    const tui = await renderTui(<Controlled onChange={() => {}} />);
    expect(tui.frame()).toContain("Backlog");
    expect(tui.frame()).not.toContain("Find Stage");
  });

  it("opens the picker on enter and chooses an option", async () => {
    const onChange = vi.fn();
    const tui = await renderTui(<Controlled onChange={onChange} />);
    await open(tui, keys.enter);
    expect(tui.frame()).toContain("Find Stage");
    expect(tui.frame()).toContain("Selected: Backlog");
    await tui.press(keys.down, keys.enter);
    expect(onChange).toHaveBeenCalledWith("DOING");
    expect(tui.frame()).not.toContain("Find Stage");
    expect(tui.frame()).toContain("In progress");
  });

  it("opens the picker with a typed letter as the query", async () => {
    const onChange = vi.fn();
    const tui = await renderTui(<Controlled onChange={onChange} />);
    await open(tui, "p");
    expect(tui.frame()).toContain("Find Stage");
    await tui.type("rog");
    await tui.press(keys.enter);
    expect(onChange).toHaveBeenCalledWith("DOING");
  });

  it("keeps the value when the picker is cancelled", async () => {
    const onChange = vi.fn();
    const tui = await renderTui(<Controlled onChange={onChange} />);
    await open(tui, keys.enter);
    await tui.press(keys.escape);
    expect(tui.frame()).not.toContain("Find Stage");
    expect(tui.frame()).toContain("Backlog");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not open on arrows, ctrl keys or while not focused", async () => {
    const tui = await renderTui(<Controlled onChange={() => {}} />);
    await tui.press(keys.down, keys.left, keys.ctrl("s"));
    await settle(30);
    expect(tui.frame()).not.toContain("Find Stage");
    const unfocused = await renderTui(<Controlled onChange={() => {}} focused={false} />);
    await open(unfocused, keys.enter);
    expect(unfocused.frame()).not.toContain("Find Stage");
  });
});
