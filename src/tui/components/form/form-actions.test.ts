import { describe, expect, it, vi } from "vitest";
import { ValidationError } from "../../../services/errors/errors.js";
import type { ToastStore } from "../../hooks/index.js";
import { type FormEnv, focusField, moveFocus, setField, submitForm } from "./form-actions.js";
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

describe("form actions", () => {
  it("sets a field and clears its error", () => {
    const { env, state } = testEnv(rawValues(FIELDS, {}));

    state.errors = { name: "required", key: "x" } as never;
    setField(env, "name", "a");

    expect(state.values).toMatchObject({ name: "a" });
    expect(state.errors).toEqual({ key: "x" });
  });

  it("gives a parent that holds the values all of its values", () => {
    const onChange = vi.fn();
    const { env } = testEnv(rawValues(FIELDS, {}), 0, { controlled: { name: "a", other: 1 }, onChange });

    setField(env, "name", "b");

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ name: "b", other: 1, key: "" }));
  });

  it("fills the fields from the field it leaves, and moves the focus within the fields", () => {
    const { env, state } = testEnv({ ...rawValues(FIELDS, {}), name: "ab" });

    moveFocus(env, -3);

    expect(state.values).toMatchObject({ key: "AB" });
    expect(state.filled).toEqual({ key: "AB" });
    expect(state.focus).toBe(0);

    focusField({ ...env, focus: 2 }, 9);

    expect(state.focus).toBe(5);
  });

  it("does not submit invalid values", async () => {
    const onInvalid = vi.fn();
    const { env, state } = testEnv(rawValues(FIELDS, {}), 0, { onInvalid });

    await submitForm(env);

    expect(state.errors).toEqual({ name: "required" });
    expect(onInvalid).toHaveBeenCalled();
    expect(env.onSubmit).not.toHaveBeenCalled();
  });

  it("shows the issues of a ValidationError and a toast for another error", async () => {
    const issues = [{ path: ["key"], message: "taken" }, { message: "other" }];
    const failing = vi.fn().mockRejectedValue(new ValidationError("bad", { details: { issues } }));
    const { env, state } = testEnv({ ...rawValues(FIELDS, {}), name: "a" }, 0, { onSubmit: failing });

    await submitForm(env);

    expect(state.errors).toEqual({ key: "taken" });
    expect(state.formErrors).toEqual(["other"]);
    expect(env.setBusy).toHaveBeenLastCalledWith(false);

    const crash = new Error("boom");
    const other = testEnv({ ...rawValues(FIELDS, {}), name: "a" }, 0, { onSubmit: vi.fn().mockRejectedValue(crash) });

    await submitForm(other.env);

    expect(other.env.toast.error).toHaveBeenCalledWith(crash);
  });
});
