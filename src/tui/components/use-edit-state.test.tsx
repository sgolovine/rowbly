import { Text, useInput } from "ink";
import { cleanup } from "ink-testing-library";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keys, renderTui } from "../testing/index.js";
import { editKey } from "./text-editing.js";
import { useEditState } from "./use-edit-state.js";

afterEach(cleanup);

function Probe({ value, onChange }: { value: string; onChange(value: string): void }) {
  const [state, apply, latest] = useEditState(value, onChange);
  useInput((input, k) => {
    const next = editKey(latest.current, input, k, true);
    if (next) apply(next);
  });
  return <Text>{`${JSON.stringify(state.value)}|${state.cursor}`}</Text>;
}

function Controlled({ onChange }: { onChange(value: string): void }) {
  const [value, setValue] = useState("");
  return (
    <Probe
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe("useEditState", () => {
  it("starts with the caret after the text", async () => {
    const tui = await renderTui(<Probe value="abc" onChange={vi.fn()} />);
    expect(tui.frame()).toContain('"abc"|3');
  });

  it("reports each change of the text once, and the latest ref holds the new state", async () => {
    const onChange = vi.fn();
    const tui = await renderTui(<Controlled onChange={onChange} />);
    await tui.press("a", keys.enter, "b");
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenLastCalledWith("a\nb");
    expect(tui.frame()).toContain('"a\\nb"|3');
  });
});
