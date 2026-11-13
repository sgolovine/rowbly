import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { renderTui } from "../../testing/index.js";
import type { FormField, FormValues } from "./form-values.js";
import { useFormState } from "./use-form-state.js";

afterEach(cleanup);

const FIELDS: FormField[] = [
  { name: "name", label: "Name", kind: "text" },
  { name: "key", label: "Key", kind: "text", fillFrom: { field: "name", format: (text) => text.toUpperCase() } },
];

function Probe({ initial, controlled }: { initial: FormValues; controlled?: FormValues }) {
  const state = useFormState(FIELDS, initial, controlled);

  return <Text>{JSON.stringify({ values: state.values, filled: state.filled, focus: state.focus })}</Text>;
}

describe("useFormState", () => {
  it("starts from the initial values, with the fills that fillFrom would give", async () => {
    const tui = await renderTui(<Probe initial={{ name: "ab", key: "AB" }} />);

    expect(tui.frame()).toContain('{"values":{"name":"ab","key":"AB"},"filled":{"key":"AB"},"focus":0}');
  });

  it("shows the values of a parent that holds them", async () => {
    const tui = await renderTui(<Probe initial={{ name: "ab" }} controlled={{ name: "cd", key: null }} />);

    expect(tui.frame()).toContain('"values":{"name":"cd","key":""}');
  });
});
