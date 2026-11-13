import { ValidationError } from "../../../services/errors/errors.js";
import type { ToastStore } from "../../hooks/index.js";
import {
  type FormField,
  type FormValues,
  fillsFrom,
  issuesByField,
  parseAll,
  type Raw,
  type RawValues,
} from "./form-values.js";
import type { FormState } from "./use-form-state.js";

/** The state, the setters and the props that the handlers of a `Form` use. */
export interface FormEnv extends FormState {
  // The fields
  readonly fields: readonly FormField[];
  /** The focused field; undefined when the focus is after the last field, where `enter` submits. */
  readonly field: FormField | undefined;
  readonly searchable: boolean;

  // The props
  readonly controlled: FormValues | undefined;
  readonly navigation: boolean;
  readonly submitOnEnter: boolean;
  readonly onChange?: (values: FormValues) => void;
  readonly onSubmit: (values: FormValues) => void | Promise<void>;
  readonly onInvalid?: () => void;
  readonly toast: ToastStore;
}

/** Changes the values in the parent when it holds them, and otherwise in the form. */
function setValues(env: FormEnv, update: (prev: RawValues) => RawValues): void {
  if (env.controlled) {
    env.onChange?.({ ...env.controlled, ...update(env.values) });

    return;
  }

  env.setLocalValues(update);
}

/** Sets the value of one field and clears its error. */
export function setField(env: FormEnv, name: string, raw: Raw): void {
  setValues(env, (prev) => ({ ...prev, [name]: raw }));
  env.setErrors(({ [name]: _cleared, ...rest }) => rest);
}

/** Fills the fields that take their text from `source` when focus leaves it, and returns the values. */
function fill(env: FormEnv, source: string | undefined): RawValues {
  const fills = fillsFrom(env.fields, env.values, env.filled, source);

  if (Object.keys(fills).length === 0) {
    return env.values;
  }

  setValues(env, (prev) => ({ ...prev, ...fills }));
  env.setFilled((prev) => ({ ...prev, ...fills }));
  env.setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([name]) => !(name in fills))));

  return { ...env.values, ...fills };
}

/** Validates the values and submits them. A `ValidationError` shows its issues; another error shows a toast. */
export async function submitForm(env: FormEnv): Promise<void> {
  const current = fill(env, env.field?.name);
  const { parsed, found } = parseAll(env.fields, current);

  env.setErrors(found);
  env.setFormErrors([]);

  if (Object.keys(found).length > 0) {
    env.onInvalid?.();

    return;
  }

  env.setBusy(true);

  try {
    await env.onSubmit(parsed);
  } catch (err) {
    showSubmitError(env, err);
  } finally {
    env.setBusy(false);
  }
}

function showSubmitError(env: FormEnv, err: unknown): void {
  if (err instanceof ValidationError) {
    const { byField, rest } = issuesByField(err, env.fields);

    env.setErrors(byField);
    env.setFormErrors(rest);

    return;
  }

  env.toast.error(err);
}

/** Moves the focus `delta` fields, after the fields that take their text from the field it leaves. */
export function moveFocus(env: FormEnv, delta: number): void {
  fill(env, env.field?.name);
  env.setFocus((focus) => Math.max(0, Math.min(env.fields.length, focus + delta)));
  env.setOptionCursor(0);
}

/** Moves the focus to the field at `index`, after a click. */
export function focusField(env: FormEnv, index: number): void {
  if (index !== env.focus) {
    moveFocus(env, index - env.focus);
  }
}
