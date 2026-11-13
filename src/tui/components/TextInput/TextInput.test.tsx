import { cleanup } from "ink-testing-library";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keys, renderTui } from "../../testing/index.js";
import { TextInput, type TextInputProps } from "./TextInput.js";

afterEach(cleanup);

function Controlled({ initial = "", onChange, ...props }: Partial<TextInputProps> & { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <TextInput
      {...props}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe("TextInput", () => {
  it("shows a dot for each character of a masked value, and reports the real text", async () => {
    const onChange = vi.fn();
    const tui = await renderTui(<Controlled mask onChange={onChange} />);
    await tui.type("sk-123");
    expect(tui.frame()).not.toContain("sk-123");
    expect(tui.frame()).toContain("••••••");
    expect(onChange).toHaveBeenLastCalledWith("sk-123");
  });

  it("shows the placeholder while empty", async () => {
    const tui = await renderTui(<Controlled placeholder="Story title" focus={false} />);
    expect(tui.frame()).toContain("Story title");
  });

  it("types text and reports each change", async () => {
    const onChange = vi.fn();
    const tui = await renderTui(<Controlled onChange={onChange} />);
    await tui.type("abc");
    expect(tui.frame()).toContain("abc");
    expect(onChange.mock.calls.map(([v]) => v)).toEqual(["a", "ab", "abc"]);
  });

  it("edits at the caret with ←/→, home/end, backspace and delete", async () => {
    const onChange = vi.fn();
    const tui = await renderTui(<Controlled initial="ace" onChange={onChange} />);
    await tui.press(keys.left, "d", keys.left, keys.left, "b");
    expect(onChange).toHaveBeenLastCalledWith("abcde");
    await tui.press(keys.home, keys.delete, keys.end, keys.backspace);
    expect(onChange).toHaveBeenLastCalledWith("bcd");
    expect(tui.frame()).toContain("bcd");
  });

  it("leaves enter, tab and esc to its parent", async () => {
    const onChange = vi.fn();
    const tui = await renderTui(<Controlled initial="x" onChange={onChange} />);
    await tui.press(keys.enter, keys.tab, keys.escape, keys.up);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("takes no keys while not focused", async () => {
    const onChange = vi.fn();
    const tui = await renderTui(<Controlled initial="x" focus={false} onChange={onChange} />);
    await tui.type("abc");
    expect(onChange).not.toHaveBeenCalled();
    expect(tui.frame()).toContain("x");
  });

  it("scrolls a long value within its width to keep the caret in view", async () => {
    const tui = await renderTui(<Controlled initial="abcdefghij" width={5} />);
    expect(tui.frame()).toContain("ghij");
    expect(tui.frame()).not.toContain("abc");
    await tui.press(keys.home);
    expect(tui.frame()).toContain("abcde");
    expect(tui.frame()).not.toContain("fgh");
  });
});
