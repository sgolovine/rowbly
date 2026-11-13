import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keys, renderTui } from "../../testing/index.js";
import type { FormField } from "./form-values.js";
import { type FormProps, useForm } from "./use-form.js";

afterEach(cleanup);

const FIELDS: FormField[] = [
  { name: "done", label: "Done", kind: "boolean" },
  { name: "stage", label: "Stage", kind: "select", options: ["A", "B"], searchable: true },
];

function Probe(props: FormProps) {
  const form = useForm(props);

  return <Text>{JSON.stringify({ values: form.values, focus: form.focus, searchable: form.searchable })}</Text>;
}

describe("useForm", () => {
  it("changes the focused field with its keys", async () => {
    const tui = await renderTui(<Probe fields={FIELDS} onSubmit={vi.fn()} submitLabel="apply" />);

    await tui.press(" ", keys.down);

    expect(tui.frame()).toContain('{"values":{"done":true,"stage":null},"focus":1,"searchable":true}');
  });

  it("submits when the submit request increases", async () => {
    const onSubmit = vi.fn();
    const tui = await renderTui(<Probe fields={FIELDS} onSubmit={onSubmit} />);

    expect(onSubmit).not.toHaveBeenCalled();

    await tui.rerender(<Probe fields={FIELDS} onSubmit={onSubmit} submitRequest={1} />);
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ done: false, stage: null }));
  });
});
