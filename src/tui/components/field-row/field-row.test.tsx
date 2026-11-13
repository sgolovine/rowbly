import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../testing/index.js";
import type { FormField } from "../form/index.js";
import { FieldRow } from "./field-row.js";

afterEach(cleanup);

const FIELD: FormField = { name: "title", label: "Title", kind: "text", required: true };

function setup(props: Partial<Parameters<typeof FieldRow>[0]> = {}) {
  const onClick = vi.fn();
  const tui = renderTui(
    <FieldRow
      field={FIELD}
      raw="Fix bug"
      focused={false}
      active
      labelWidth={10}
      inputWidth={20}
      optionCursor={0}
      onChange={() => {}}
      onLeave={() => {}}
      onClick={onClick}
      {...props}
    />,
  );
  return { tui, onClick };
}

describe("FieldRow", () => {
  it("shows the label with the required mark and the value", async () => {
    const frame = (await setup().tui).frame();
    expect(frame).toContain("  Title*");
    expect(frame).toContain("Fix bug");
  });

  it("marks the focused field", async () => {
    expect((await setup({ focused: true }).tui).frame()).toContain("› Title*");
  });

  it("shows the error below the input column", async () => {
    const lines = (await setup({ error: "required" }).tui).frame().split("\n");
    expect(lines[1]).toBe(`${" ".repeat(10)}! required`);
  });

  it("calls onClick on a click while active, and not otherwise", async () => {
    const { tui, onClick } = setup();
    await (await tui).click("Fix bug");
    expect(onClick).toHaveBeenCalledOnce();
    const inactive = setup({ active: false });
    await (await inactive.tui).click("Fix bug");
    expect(inactive.onClick).not.toHaveBeenCalled();
  });
});
