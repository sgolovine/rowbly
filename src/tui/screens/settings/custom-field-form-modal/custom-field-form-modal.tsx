import { CUSTOM_FIELD_TYPES, type CustomField, type CustomFieldType } from "../../../../services/config/config.js";
import { addCustomField, updateCustomField } from "../../../../services/custom-field/custom-field.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { FormModal, type FormValues } from "../../../components/index.js";
import { showToast, type ToastStore, useToast } from "../../../hooks/index.js";

/** `"a, b ,c"` → `["a", "b", "c"]`. */
function parseOptions(text: string): string[] {
  return text
    .split(",")
    .map((option) => option.trim())
    .filter((option) => option !== "");
}

/** What a save of the form reads. */
interface FieldFormEnv {
  readonly ctx: ServiceContext;
  readonly field: CustomField | undefined;
  readonly toast: ToastStore;
  readonly onSaved: (field: CustomField) => void;
}

/** Adds the field, or updates the field that the form edits. A `select` field keeps its options. */
async function saveField(env: FieldFormEnv, values: FormValues): Promise<void> {
  const type = String(values.type) as CustomFieldType;
  const input = {
    label: String(values.label ?? ""),
    type,
    options: type === "select" ? parseOptions(String(values.options ?? "")) : undefined,
  };

  const saved = env.field
    ? await updateCustomField({ key: env.field.key, ...input }, env.ctx)
    : await addCustomField(input, env.ctx);

  showToast(env.toast, "info", env.field ? `Updated ${saved.label}` : `Added ${saved.label}`);
  env.onSaved(saved);
}

/**
 * Adds a Custom Field, or edits `field`, in a generic Modal: its name, its type and, for a `select`
 * field, its options. If the type changes, the service converts the values of the Stories, or it
 * refuses the change.
 */
export function CustomFieldFormModal({
  ctx,
  field,
  onSaved,
  onClose,
}: {
  ctx: ServiceContext;
  /** The field to edit. Without it, the form adds a field. */
  field?: CustomField;
  onSaved(field: CustomField): void;
  onClose(): void;
}) {
  const toast = useToast();

  const env: FieldFormEnv = { ctx, field, toast, onSaved };

  return (
    <FormModal
      title={field ? `Edit Custom Field › ${field.label}` : "New Custom Field"}
      fields={[
        { name: "label", label: "Name", kind: "text", required: true },
        { name: "type", label: "Type", kind: "select", options: CUSTOM_FIELD_TYPES, required: true },
        { name: "options", label: "Select options", kind: "text" },
      ]}
      initialValues={{
        label: field?.label ?? "",
        type: field?.type ?? "string",
        options: field?.options?.join(", ") ?? "",
      }}
      onSubmit={(values) => saveField(env, values)}
      onClose={onClose}
    />
  );
}
