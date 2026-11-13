import { type Key, Text, useInput } from "ink";
import { cleanup } from "ink-testing-library";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keys, renderTui } from "../testing/index.js";
import { editKey, follow, moveRow, rowOf, useEditState, WithCaret, wrapRows } from "./text-editing.js";

afterEach(cleanup);

const key = (partial: Partial<Key> = {}) => partial as Key;

describe("wrapRows", () => {
  it("breaks at newlines and then at the width", () => {
    expect(wrapRows("ab\ncdef", 2)).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
      { start: 5, end: 7 },
    ]);
  });

  it("keeps one row for an empty text and for an empty line", () => {
    expect(wrapRows("", 4)).toEqual([{ start: 0, end: 0 }]);
    expect(wrapRows("a\n\nb", 4)).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 2 },
      { start: 3, end: 4 },
    ]);
  });
});

describe("rowOf", () => {
  it("puts a caret on a wrap point in the row that it starts", () => {
    const rows = wrapRows("abcd", 2);
    expect(rowOf(rows, 1)).toBe(0);
    expect(rowOf(rows, 2)).toBe(1);
    expect(rowOf(rows, 4)).toBe(1);
  });
});

describe("moveRow", () => {
  const value = "abcd\nx";
  const rows = wrapRows(value, 10);

  it("keeps the column, clamped to the end of the target row", () => {
    expect(moveRow({ value, cursor: 1 }, rows, 1)).toEqual({ value, cursor: 6 });
    expect(moveRow({ value, cursor: 6 }, rows, -1)).toEqual({ value, cursor: 1 });
    expect(moveRow({ value: "ab\ncd", cursor: 4 }, wrapRows("ab\ncd", 10), -1)?.cursor).toBe(1);
  });

  it("returns null when there is no row there", () => {
    expect(moveRow({ value, cursor: 1 }, rows, -1)).toBeNull();
    expect(moveRow({ value, cursor: 6 }, rows, 1)).toBeNull();
  });
});

describe("editKey", () => {
  const at = (cursor: number) => ({ value: "ab\ncd", cursor });

  it("inserts typed text at the caret", () => {
    expect(editKey({ value: "ac", cursor: 1 }, "b", key(), false)).toEqual({ value: "abc", cursor: 2 });
  });

  it("deletes with backspace and delete", () => {
    expect(editKey(at(1), "", key({ backspace: true }), false)).toEqual({ value: "b\ncd", cursor: 0 });
    expect(editKey(at(0), "", key({ backspace: true }), false)).toEqual(at(0));
    expect(editKey(at(1), "", key({ delete: true }), false)).toEqual({ value: "a\ncd", cursor: 1 });
  });

  it("moves the caret within the text and the line", () => {
    expect(editKey(at(0), "", key({ leftArrow: true }), false)?.cursor).toBe(0);
    expect(editKey(at(5), "", key({ rightArrow: true }), false)?.cursor).toBe(5);
    expect(editKey(at(4), "", key({ home: true }), false)?.cursor).toBe(3);
    expect(editKey(at(3), "", key({ end: true }), false)?.cursor).toBe(5);
    expect(editKey(at(4), "a", key({ ctrl: true }), false)?.cursor).toBe(3);
    expect(editKey(at(0), "e", key({ ctrl: true }), false)?.cursor).toBe(2);
  });

  it("inserts a newline on enter only in multiline mode", () => {
    expect(editKey(at(2), "\r", key({ return: true }), true)).toEqual({ value: "ab\n\ncd", cursor: 3 });
    expect(editKey(at(2), "\r", key({ return: true }), false)).toBeNull();
    expect(editKey(at(2), "\r", key({ return: true, ctrl: true }), true)).toBeNull();
  });

  it("keeps pasted newlines only in multiline mode", () => {
    expect(editKey({ value: "", cursor: 0 }, "a\r\nb", key(), true)?.value).toBe("a\nb");
    expect(editKey({ value: "", cursor: 0 }, "a\r\nb", key(), false)?.value).toBe("ab");
  });

  it("leaves other keys to the caller", () => {
    for (const k of [{ upArrow: true }, { downArrow: true }, { tab: true }, { escape: true }]) {
      expect(editKey(at(0), "", key(k), true)).toBeNull();
    }
    expect(editKey(at(0), "s", key({ ctrl: true }), true)).toBeNull();
  });
});

describe("follow", () => {
  it("keeps the cursor within the window", () => {
    expect(follow(0, 10, 5)).toBe(6);
    expect(follow(6, 3, 5)).toBe(3);
    expect(follow(2, 4, 5)).toBe(2);
  });
});

describe("WithCaret", () => {
  it("shows the text, with a space for a caret after the end", async () => {
    const tui = await renderTui(
      <Text>
        [<WithCaret text="abc" at={3} />]
      </Text>,
    );
    expect(tui.frame()).toContain("[abc ]");
  });
});

function Probe({ value, onChange }: { value: string; onChange(value: string): void }) {
  const [state, apply, latest] = useEditState(value, onChange);
  useInput((input, k) => {
    const next = editKey(latest.current, input, k, false);
    if (next) apply(next);
  });
  return <Text>{`${state.value}|${state.cursor}`}</Text>;
}

function Parent({ next }: { next: string }) {
  const [value, setValue] = useState("abc");
  return <Probe value={next || value} onChange={setValue} />;
}

describe("useEditState", () => {
  it("reports value changes but not caret moves", async () => {
    const onChange = vi.fn();
    const tui = await renderTui(<Probe value="ab" onChange={onChange} />);
    expect(tui.frame()).toContain("ab|2");
    await tui.press(keys.left);
    expect(tui.frame()).toContain("ab|1");
    expect(onChange).not.toHaveBeenCalled();
    await tui.press("x");
    expect(onChange).toHaveBeenCalledWith("axb");
  });

  it("applies keys that arrive before a re-render", async () => {
    const onChange = vi.fn();
    const tui = await renderTui(<Probe value="" onChange={onChange} />);
    // Two writes in a row deliver both keys before a re-render.
    tui.ink.stdin.write("a");
    tui.ink.stdin.write("b");
    await tui.press("");
    expect(onChange).toHaveBeenLastCalledWith("ab");
  });

  it("keeps a caret at the end, and clamps others, when the parent changes the value", async () => {
    const tui = await renderTui(<Parent next="" />);
    await tui.rerender(<Parent next="abcdef" />);
    expect(tui.frame()).toContain("abcdef|6");
    await tui.press(keys.left, keys.left, keys.left, keys.left);
    expect(tui.frame()).toContain("abcdef|2");
    await tui.rerender(<Parent next="wxyz" />);
    expect(tui.frame()).toContain("wxyz|2");
    await tui.rerender(<Parent next="w" />);
    expect(tui.frame()).toContain("w|1");
  });
});
