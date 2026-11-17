import { showToast, type ToastStore, useToast } from "../../hooks/index.js";
import type { FormField, FormValues } from "../form/index.js";
import { FormModal } from "../form-modal/index.js";

export interface EntityFormModalProps<T> {
  /** The name of the record kind in the title, for example `Custom Field`. */
  noun: string;
  /** The record to edit. Without it, the form creates a record. */
  existing?: T;
  /** The part of the edit title after `›`, for example the label or the tag value. */
  titleOf(existing: T): string;
  fields: readonly FormField[];
  initialValues: FormValues;
  /** Calls the service. May throw a `ValidationError`. */
  save(values: FormValues, existing: T | undefined): Promise<T>;
  /** The name of the saved record in the toast. */
  labelOf(saved: T): string;
  /** The verb of the toast when the form creates a record. Default `Added`. */
  verb?: string;
  onSaved(saved: T): void;
  onClose(): void;
}

/** What a save of the form reads. */
interface EntityFormEnv<T> {
  readonly existing: T | undefined;
  readonly save: (values: FormValues, existing: T | undefined) => Promise<T>;
  readonly labelOf: (saved: T) => string;
  readonly verb: string;
  readonly toast: ToastStore;
  readonly onSaved: (saved: T) => void;
}

/** Saves the record, shows the info toast, then gives the saved record to `onSaved`. */
async function submitEntity<T>(env: EntityFormEnv<T>, values: FormValues): Promise<void> {
  const saved = await env.save(values, env.existing);
  const label = env.labelOf(saved);

  showToast(env.toast, "info", env.existing ? `Updated ${label}` : `${env.verb} ${label}`);
  env.onSaved(saved);
}

/**
 * A `FormModal` that creates a record, or edits `existing`. It owns the title, the save toast and the
 * call of `onSaved`; the caller gives the fields and the service call. A `ValidationError` from `save`
 * goes through `FormModal` unchanged and shows its issues under the fields.
 */
export function EntityFormModal<T>({
  noun,
  existing,
  titleOf,
  fields,
  initialValues,
  save,
  labelOf,
  verb = "Added",
  onSaved,
  onClose,
}: EntityFormModalProps<T>) {
  const toast = useToast();

  const env: EntityFormEnv<T> = { existing, save, labelOf, verb, toast, onSaved };

  return (
    <FormModal
      title={existing ? `Edit ${noun} › ${titleOf(existing)}` : `New ${noun}`}
      fields={fields}
      initialValues={initialValues}
      onSubmit={(values) => submitEntity(env, values)}
      onClose={onClose}
    />
  );
}
