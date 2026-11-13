import type { Key } from "ink";
import { describe, expect, it, vi } from "vitest";
import type { ToastStore } from "../../hooks/index.js";
import type { FormEnv } from "./form-actions.js";
import { handleFormKey } from "./form-input.js";
import { type FormField, type RawValues, rawValues } from "./form-values.js";

const FIELDS: FormField[] = [
  { name: "name", label: "Name", kind: "text", required: true },
  { name: "key", label: "Key", kind: "text", fillFrom: { field: "name", format: (text) => text.toUpperCase() } },
  { name: "done", label: "Done", kind: "boolean" },
  { name: "stage", label: "Stage", kind: "select", options: ["A", "B", "C"] },
  { name: "tags", label: "Tags", kind: "multiselect", options: ["x", "y"] },
];

/** Gives each setter a mock that applies an update to the state of the env, so that a test can read the result. */
function testEnv(values: RawValues, focus = 0, overrides: Partial<FormEnv> = {}) {
  const state = { values, filled: {}, errors: {}, focus, optionCursor: 0, formErrors: [] as readonly string[] };
  const apply = (name: keyof typeof state) =>
    vi.fn((update: unknown) => {
      Object.assign(state, { [name]: typeof update === "function" ? update(state[name]) : update });
    });
  const env: FormEnv = {
    initial: rawValues(FIELDS, {}),
    values,
    filled: {},
    focus,
    optionCursor: 0,
    errors: {},
    formErrors: [],
    busy: false,
    setLocalValues: apply("values"),
    setFilled: apply("filled"),
    setFocus: apply("focus"),
    setOptionCursor: apply("optionCursor"),
    setErrors: apply("errors"),
    setFormErrors: apply("formErrors"),
    setBusy: vi.fn(),
    fields: FIELDS,
    field: FIELDS[focus],
    searchable: false,
    controlled: undefined,
    navigation: false,
    submitOnEnter: false,
    onSubmit: vi.fn(),
    toast: { error: vi.fn() } as unknown as ToastStore,
    ...overrides,
  };

  return { env, state };
}

function key(over: Partial<Key> = {}): Key {
  return over as Key;
}

describe("handleFormKey", () => {
  it("toggles a boolean, cycles a select and picks multiselect options", () => {
    const boolean = testEnv(rawValues(FIELDS, {}), 2);

    handleFormKey(boolean.env, " ", key());
    expect(boolean.state.values).toMatchObject({ done: true });

    const select = testEnv(rawValues(FIELDS, {}), 3);

    handleFormKey(select.env, "h", key());
    // With no value, the step starts before the first option.
    expect(select.state.values).toMatchObject({ stage: "B" });
    handleFormKey(select.env, "", key({ rightArrow: true, shift: true }));
    expect(select.env.setLocalValues).toHaveBeenCalledTimes(1);

    const multi = testEnv(rawValues(FIELDS, {}), 4);

    handleFormKey(multi.env, "l", key());
    expect(multi.state.optionCursor).toBe(1);
    handleFormKey(multi.env, " ", key());
    expect(multi.state.values).toMatchObject({ tags: ["x"] });
  });

  it("moves between fields and submits after the last field", () => {
    const text = testEnv({ ...rawValues(FIELDS, {}), name: "a" }, 0);

    // A text field takes `j` as text, through its TextInput.
    handleFormKey(text.env, "j", key());
    expect(text.env.setFocus).not.toHaveBeenCalled();
    handleFormKey(text.env, "", key({ downArrow: true }));
    expect(text.state.focus).toBe(1);

    const last = testEnv({ ...rawValues(FIELDS, {}), name: "a" }, FIELDS.length);

    handleFormKey(last.env, "", key({ return: true }));
    expect(last.env.onSubmit).toHaveBeenCalled();
  });

  it("leaves the submit key and shift+tab to a create host with tabs", () => {
    const { env } = testEnv({ ...rawValues(FIELDS, {}), name: "a" }, 0, { navigation: true });

    handleFormKey(env, "s", key({ ctrl: true }));
    handleFormKey(env, "", key({ tab: true, shift: true }));

    expect(env.onSubmit).not.toHaveBeenCalled();
    expect(env.setFocus).not.toHaveBeenCalled();
  });

  it("takes no keys while it submits", () => {
    const { env } = testEnv(rawValues(FIELDS, {}), 2, { busy: true });

    handleFormKey(env, " ", key());

    expect(env.setLocalValues).not.toHaveBeenCalled();
  });
});
