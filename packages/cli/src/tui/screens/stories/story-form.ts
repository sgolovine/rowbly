import type { CustomField } from "../../../services/config/config.js";
import type { FieldValue } from "../../../services/fields/fields.js";
import type { Stage } from "../../../services/stage/stage.js";
import type { FormField, FormValue, FormValues } from "../../components/index.js";
import type { DependencyChoices } from "./story-dependency-view.js";
import type { TagChoices } from "./story-tag-view.js";

/** The choice of a select or boolean custom field that leaves it unset. */
const NONE = "—";

/**
 * The fields of the Story form: title, Stage, description, `Depends on`, `Tags` when the project has tags, then
 * the custom fields of the project.
 */
export function storyFormFields(
  stages: readonly Stage[],
  customFields: readonly CustomField[],
  dependencies: DependencyChoices,
  tags: TagChoices,
): FormField[] {
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
    {
      name: "dependsOn",
      label: "Depends on",
      kind: "multiselect",
      searchable: true,
      options: dependencies.options,
      optionLabels: dependencies.labels,
      optionSearchText: dependencies.searchText,
    },
    ...tagsFormField(tags),
    ...customFields.map(customFormField),
  ];
}

/** The `Tags` field, or no field when there are no tag choices. */
function tagsFormField(tags: TagChoices): FormField[] {
  if (tags.options.length === 0) {
    return [];
  }

  return [{ name: "tags", label: "Tags", kind: "multiselect", options: tags.options, optionLabels: tags.labels }];
}

/** The form value of a custom field: `NONE` or `""` when it is unset, otherwise its value as text. */
export function customFormValue(field: CustomField, value: FieldValue): FormValue {
  if (value === null) {
    return field.type === "boolean" || field.type === "select" ? NONE : "";
  }

  return String(value);
}

/** The input of one custom field: `null` for an empty or `NONE` value, otherwise the form value. */
function fieldInput(value: FormValue | undefined): unknown {
  return value === null || value === undefined || value === "" || value === NONE ? null : value;
}

/** Reads the form values of the custom fields. An unset field is `null`; the service parses the text by type. */
export function customFieldInput(customFields: readonly CustomField[], values: FormValues): Record<string, unknown> {
  return Object.fromEntries(customFields.map((field) => [field.key, fieldInput(values[field.key])]));
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
