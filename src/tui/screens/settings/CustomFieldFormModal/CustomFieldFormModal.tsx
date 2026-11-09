import { CUSTOM_FIELD_TYPES, type CustomField, type CustomFieldType } from "../../../../services/config/config.js";
import { addCustomField, updateCustomField } from "../../../../services/customField/customField.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { FormModal } from "../../../components/index.js";
import { useToast } from "../../../hooks/index.js";

/** `"a, b ,c"` → `["a", "b", "c"]`. */
function parseOptions(text: string): string[] {
  return text
    .split(",")
    .map((option) => option.trim())
    .filter((option) => option !== "");
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
      onSubmit={async (values) => {
        const type = String(values.type) as CustomFieldType;
        const input = {
          label: String(values.label ?? ""),
          type,
          options: type === "select" ? parseOptions(String(values.options ?? "")) : undefined,
        };
        const saved = field
          ? await updateCustomField({ key: field.key, ...input }, ctx)
          : await addCustomField(input, ctx);
        toast.push("info", field ? `Updated ${saved.label}` : `Added ${saved.label}`);
        onSaved(saved);
      }}
      onClose={onClose}
    />
  );
}
