import type { ReactNode } from "react";
import type { CustomField } from "../../../../services/config/config.js";
import { listCustomFields, removeCustomField } from "../../../../services/custom-field/custom-field.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { columnWidth } from "../column-width.js";
import { type CrudForm, CrudListSection, type CrudRow } from "../crud-list-section/index.js";
import { CustomFieldFormModal } from "../custom-field-form-modal/index.js";
import { CustomFieldRow } from "../custom-field-row/index.js";
import type { SettingsSectionProps } from "../settings-sections.js";

/** Removes the field and its values. */
function removeField(field: CustomField, ctx: ServiceContext): Promise<unknown> {
  return removeCustomField({ key: field.key }, ctx);
}

/** Gives the row renderer, with the label and key columns of all fields. */
function fieldRows(fields: readonly CustomField[]): (field: CustomField, row: CrudRow) => ReactNode {
  const labelWidth = columnWidth(fields.map((f) => f.label));
  const keyWidth = columnWidth(fields.map((f) => f.key));

  return (field, row) => <CustomFieldRow field={field} labelWidth={labelWidth} keyWidth={keyWidth} {...row} />;
}

/**
 * The Custom Fields of the project. Each Story has a value for each field. `n` or the
 * **+ New Custom Field** Button adds a field, `enter`
 * or `e` edits the selected field, as a click on its row does, and `d` removes it and its values after a confirmation.
 */
export function CustomFieldsSection({ ctx, onChange }: SettingsSectionProps) {
  return (
    <CrudListSection<CustomField>
      ctx={ctx}
      onChange={onChange}
      noun="Custom Field"
      load={listCustomFields}
      remove={removeField}
      itemKey={(field) => field.key}
      itemLabel={(field) => field.label}
      confirmTitle={(field) => field.label}
      confirmMessage={(field) => `Remove ${field.label}? Rowbly also removes its value from each Story.`}
      rows={fieldRows}
      renderForm={(field: CustomField | undefined, form: CrudForm) => (
        <CustomFieldFormModal ctx={ctx} field={field} {...form} />
      )}
    />
  );
}
