import { type Dispatch, type SetStateAction, useState } from "react";
import { type FormField, type FormValues, initialFilled, type RawValues, rawValues } from "./form-values.js";

/** The state of a `Form` and its setters. */
export interface FormState {
  // The values
  readonly initial: RawValues;
  readonly values: RawValues;
  /** The values `fillFrom` last put in each field, so a field that still holds one is filled again. */
  readonly filled: Readonly<Record<string, string>>;

  // The focus and the messages
  readonly focus: number;
  readonly optionCursor: number;
  readonly errors: Readonly<Record<string, string>>;
  readonly formErrors: readonly string[];
  readonly busy: boolean;

  // The setters
  readonly setLocalValues: Dispatch<SetStateAction<RawValues>>;
  readonly setFilled: Dispatch<SetStateAction<Readonly<Record<string, string>>>>;
  readonly setFocus: Dispatch<SetStateAction<number>>;
  readonly setOptionCursor: Dispatch<SetStateAction<number>>;
  readonly setErrors: Dispatch<SetStateAction<Readonly<Record<string, string>>>>;
  readonly setFormErrors: Dispatch<SetStateAction<readonly string[]>>;
  readonly setBusy: Dispatch<SetStateAction<boolean>>;
}

/** The state of a `Form`. With `controlled` values, the parent holds the values and the local values stay unused. */
export function useFormState(
  fields: readonly FormField[],
  initialValues: FormValues,
  controlled: FormValues | undefined,
): FormState {
  const [initial] = useState(() => rawValues(fields, initialValues));
  const [localValues, setLocalValues] = useState<RawValues>(initial);
  const [focus, setFocus] = useState(0);
  const [optionCursor, setOptionCursor] = useState(0);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [formErrors, setFormErrors] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [filled, setFilled] = useState<Readonly<Record<string, string>>>(() => initialFilled(fields, initial));

  const values = controlled ? rawValues(fields, controlled) : localValues;

  return {
    initial,
    values,
    filled,
    focus,
    optionCursor,
    errors,
    formErrors,
    busy,
    setLocalValues,
    setFilled,
    setFocus,
    setOptionCursor,
    setErrors,
    setFormErrors,
    setBusy,
  };
}
