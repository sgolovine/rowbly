import { cleanup } from "ink-testing-library";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keys, renderTui, settle } from "../../testing/index.js";
import { TextArea, type TextAreaProps } from "./text-area.js";

afterEach(cleanup);

function Controlled({ initial = "", onChange, width = 40, ...props }: Partial<TextAreaProps> & { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <TextArea
      {...props}
      width={width}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe("TextArea", () => {
  it("starts a new line on enter", async () => {
    const onChange = vi.fn();
    const tui = await renderTui(<Controlled onChange={onChange} />);
    await tui.type("ab");
    await tui.press(keys.enter);
    await tui.type("cd");
    expect(onChange).toHaveBeenLastCalledWith("ab\ncd");
    const lines = tui.frame().split("\n");
    expect(lines.findIndex((l) => l.includes("cd"))).toBe(lines.findIndex((l) => l.includes("ab")) + 1);
  });

  it("moves between rows with ↑/↓ and keeps the column", async () => {
    const onChange = vi.fn();
    const tui = await renderTui(<Controlled initial={"ab\ncd"} onChange={onChange} />);
    await tui.press(keys.up, "X");
    expect(onChange).toHaveBeenLastCalledWith("abX\ncd");
    await tui.press(keys.down, "Y");
    expect(onChange).toHaveBeenLastCalledWith("abX\ncdY");
  });

  it("calls onLeave on ↑ from the first row and ↓ from the last", async () => {
    const onLeave = vi.fn();
    const tui = await renderTui(<Controlled initial={"ab\ncd"} onLeave={onLeave} />);
    await tui.press(keys.down);
    expect(onLeave).toHaveBeenLastCalledWith(1);
    await tui.press(keys.up, keys.up);
    expect(onLeave).toHaveBeenLastCalledWith(-1);
    expect(onLeave).toHaveBeenCalledTimes(2);
  });

  it("shows the placeholder while empty and not focused", async () => {
    const tui = await renderTui(<Controlled placeholder="(empty)" focus={false} />);
    expect(tui.frame()).toContain("(empty)");
  });

  it("shows the visible rows of a long text", async () => {
    const tui = await renderTui(<Controlled initial={"1\n2\n3\n4"} rows={2} />);
    expect(tui.frame()).toContain("↑↓ 3–4 of 4");
  });

  it("opens the full-screen editor on ctrl+f, and its edits go to onChange", async () => {
    const onChange = vi.fn();
    const tui = await renderTui(<Controlled initial="ab" title="Description" onChange={onChange} />);
    expect(tui.frame()).toContain("[Full screen]");
    await tui.press(keys.ctrl("f"));
    // The overlay takes a few renders to open and take keys.
    await settle(30);
    expect(tui.frame()).toContain("Description");
    expect(tui.frame()).toContain("Edit");
    await tui.type("cd");
    expect(onChange).toHaveBeenLastCalledWith("abcd");
    await tui.press(keys.escape);
    expect(tui.frame()).not.toContain("Description");
    expect(tui.frame()).toContain("abcd");
    // The text area takes keys again after the editor closes.
    await tui.type("e");
    expect(onChange).toHaveBeenLastCalledWith("abcde");
  });

  it("opens the full-screen editor on a click on the button", async () => {
    const tui = await renderTui(<Controlled initial="ab" title="Description" />);
    await tui.click("[Full screen]");
    expect(tui.frame()).toContain("Description");
  });

  it("has no Full screen button or ctrl+f while not expandable", async () => {
    const onChange = vi.fn();
    const tui = await renderTui(<Controlled initial="ab" title="Description" expandable={false} onChange={onChange} />);
    expect(tui.frame()).not.toContain("Full screen");
    await tui.press(keys.ctrl("f"));
    expect(tui.frame()).not.toContain("Description");
    expect(onChange).not.toHaveBeenCalled();
  });
});
