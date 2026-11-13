import { useInput } from "ink";
import { useContext, useEffect, useId, useMemo, useRef } from "react";
import { useDirty, useIsActive, useToast, writeRef } from "../../hooks/index.js";
import type { KeyHint } from "../../keymap.js";
import { FormNavigationContext } from "../form-navigation.js";
import { useCovered } from "../modal-layer.js";
import { type FormEnv, submitForm } from "./form-actions.js";
import { handleFormKey } from "./form-input.js";
import { type FormField, type FormValues, isDirty } from "./form-values.js";
import { formHints, useFormKeys, withExtraHints } from "./use-form-keys.js";
import { useFormState } from "./use-form-state.js";

export interface FormProps {
  fields: readonly FormField[];
  initialValues?: FormValues;
  /** May throw: a `ValidationError` shows its issues inline, any other error becomes a toast. */
  onSubmit(values: FormValues): void | Promise<void>;
  isActive?: boolean;
  /** What the `ctrl+s` hint says the form does: `save` (the default), or e.g. `apply` for a filter. */
  submitLabel?: string;
  /** `enter` on a text, number or date field submits, like `ctrl+s`, instead of moving to the next field. */
  submitOnEnter?: boolean;
  /** Screen-specific keys shown after save, before navigation hints. */
  extraHints?: readonly KeyHint[];
  /** Controlled values for forms whose drafts outlive the mounted editor. */
  values?: FormValues;
  onChange?(values: FormValues): void;
  /** Increment to validate and submit this form from another create tab. */
  submitRequest?: number;
  onInvalid?(): void;
}

/** What a `Form` renders: the handler environment, whether it takes keys, and the label of its submit key. */
export interface FormView extends FormEnv {
  readonly active: boolean;
  readonly submitLabel: string;
}

const NO_EXTRA_HINTS: readonly KeyHint[] = [];

function isSearchable(field: FormField | undefined): boolean {
  return field?.kind === "select" && field.searchable === true;
}

/** The state, the keys and the key hints of a `Form`. */
export function useForm({
  fields,
  initialValues = {},
  onSubmit,
  isActive = true,
  submitLabel = "save",
  submitOnEnter = false,
  extraHints,
  values: controlled,
  onChange,
  submitRequest = 0,
  onInvalid,
}: FormProps): FormView {
  const covered = useCovered();
  const active = useIsActive() && isActive && !covered;
  const navigation = useContext(FormNavigationContext);
  const formId = useId();
  const toast = useToast();
  const state = useFormState(fields, initialValues, controlled);

  const hints = extraHints ?? navigation?.extraHints ?? NO_EXTRA_HINTS;
  // `focus === fields.length` accepts Enter to submit without a separate button.
  const field = fields[state.focus];
  const searchable = isSearchable(field);
  const env: FormEnv = {
    ...state,
    fields,
    field,
    searchable,
    controlled,
    navigation: navigation !== null,
    submitOnEnter,
    onChange,
    onSubmit,
    onInvalid,
    toast,
  };
  const keys = useMemo(
    () => formHints({ navigation: navigation !== null, submitLabel, searchable, submitOnEnter }),
    [navigation, submitLabel, searchable, submitOnEnter],
  );
  // External save requests validate Details even while another tab is visible, with the values of the last render.
  const latest = useRef(env);

  writeRef(latest, env);
  useEffect(() => navigation?.register(formId, active && field !== undefined), [navigation, formId, active, field]);
  useFormKeys(
    active,
    useMemo(() => withExtraHints(keys, hints), [keys, hints]),
  );
  useDirty(isDirty(fields, state.values, state.initial));
  useEffect(() => {
    if (submitRequest > 0) {
      void submitForm(latest.current);
    }
  }, [submitRequest]);
  useInput((input, key) => handleFormKey(env, input, key), { isActive: active });

  return { ...env, active, submitLabel };
}
