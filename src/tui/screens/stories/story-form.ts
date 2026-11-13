import type { CustomField } from "../../../services/config/config.js";
import type { FieldValue } from "../../../services/fields/fields.js";
import type { Stage } from "../../../services/stage/stage.js";
import type { FormField, FormValue, FormValues } from "../../components/index.js";

/** The choice of a select or boolean custom field that leaves it unset. */
const NONE = "—";

/** The fields of the Story form: title, Stage, description, then the custom fields of the project. */
export function storyFormFields(stages: readonly Stage[], customFields: readonly CustomField[]): FormField[] {
  return [
    { name: "title", label: "Title", kind: "text", required: true },
    {
      name: "stage",
      label: "Stage",
      kind: "select",
      required: true,
      options: stages.map((s) => s.key),
      optionLabels: Object.fromEntries(stages.map((s) => [s.key, s.label])),
    },
    { name: "description", label: "Description", kind: "multiline" },
    ...customFields.map(customFormField),
  ];
}

/** The form value of a custom field: `NONE` or `""` when it is unset, otherwise its value as text. */
export function customFormValue(field: CustomField, value: FieldValue): FormValue {
  if (value === null) {
    return field.type === "boolean" || field.type === "select" ? NONE : "";
  }
  return String(value);
}

/** Reads the form values of the custom fields. An unset field is `null`; the service parses the text by type. */
export function customFieldInput(customFields: readonly CustomField[], values: FormValues): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const field of customFields) {
    const value = values[field.key];
    fields[field.key] = value === null || value === undefined || value === "" || value === NONE ? null : value;
  }
  return fields;
}

/** A form field for a custom field. Its text goes to the service, which parses it by the field's type. */
function customFormField(field: CustomField): FormField {
  switch (field.type) {
    case "boolean":
      return { name: field.key, label: field.label, kind: "select", options: [NONE, "true", "false"] };
    case "select":
      return { name: field.key, label: field.label, kind: "select", options: [NONE, ...(field.options ?? [])] };
    default:
      return { name: field.key, label: field.label, kind: "text" };
  }
}
