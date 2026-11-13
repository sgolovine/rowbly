import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keys, renderTui } from "../../testing/index.js";
import type { FormField } from "../form/index.js";
import { FieldValue } from "./field-value.js";

afterEach(cleanup);

type Raw = Parameters<typeof FieldValue>[0]["raw"];

function show(field: FormField, raw: Raw, props: Partial<Parameters<typeof FieldValue>[0]> = {}) {
  return renderTui(
    <FieldValue
      field={field}
      raw={raw}
      focused={false}
      optionCursor={0}
      width={30}
      onChange={() => {}}
      onLeave={() => {}}
      {...props}
    />,
  );
}

const SELECT: FormField = {
  name: "stage",
  label: "Stage",
  kind: "select",
  options: ["BACKLOG", "DONE"],
  optionLabels: { BACKLOG: "Backlog" },
};

describe("FieldValue", () => {
  it("shows a boolean as a checkbox", async () => {
    const field: FormField = { name: "b", label: "B", kind: "boolean" };
    expect((await show(field, true)).frame()).toBe("[x] yes");
    expect((await show(field, false)).frame()).toBe("[ ] no");
  });

  it("shows a switch with the label of its state, and toggles it on a click", async () => {
    const field: FormField = {
      name: "e",
      label: "E",
      kind: "switch",
      switchLabels: { on: "Enabled", off: "Disabled" },
    };
    expect((await show(field, true)).frame()).toBe("━━● Enabled");
    const onChange = vi.fn();
    const tui = await show(field, false, { onChange });
    expect(tui.frame()).toBe("●── Disabled");
    await tui.click("Disabled");
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("shows a select with its option label, the value, or a dash", async () => {
    expect((await show(SELECT, "BACKLOG")).frame()).toBe("‹ Backlog ›");
    expect((await show(SELECT, "DONE")).frame()).toBe("‹ DONE ›");
    expect((await show(SELECT, null)).frame()).toBe("‹ — ›");
  });

  it("shows a searchable select as its label, or a dash", async () => {
    expect((await show({ ...SELECT, searchable: true }, "BACKLOG")).frame()).toBe("Backlog");
    expect((await show({ ...SELECT, searchable: true }, null)).frame()).toBe("—");
  });

  it("shows each multiselect option with its checkbox", async () => {
    const field: FormField = { name: "t", label: "T", kind: "multiselect", options: ["ui", "cli"] };
    const frame = (await show(field, ["cli"])).frame();
    expect(frame).toContain("[ ] ui");
    expect(frame).toContain("[x] cli");
  });

  it("shows placeholders for an empty date and an empty multiline text", async () => {
    expect((await show({ name: "d", label: "D", kind: "date" }, "")).frame()).toContain("YYYY-MM-DD");
    expect((await show({ name: "m", label: "M", kind: "multiline" }, "")).frame()).toContain("(empty)");
  });

  it("edits a text in a TextInput while focused", async () => {
    const onChange = vi.fn();
    const tui = await show({ name: "t", label: "T", kind: "text" }, "ab", { focused: true, onChange });
    await tui.press("c");
    expect(onChange).toHaveBeenCalledWith("abc");
  });

  it("passes onLeave to a multiline TextArea", async () => {
    const onLeave = vi.fn();
    const tui = await show({ name: "m", label: "M", kind: "multiline" }, "ab", { focused: true, onLeave });
    await tui.press(keys.down);
    expect(onLeave).toHaveBeenCalledWith(1);
  });
});
