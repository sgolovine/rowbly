import { Text } from "ink";
import type { CustomField } from "../../../../services/config/config.js";
import { ColumnRow, subtleColor } from "../../../components/index.js";
import { theme } from "../../../theme.js";

/** The props of `CustomFieldRow`. */
export interface CustomFieldRowProps {
  readonly field: CustomField;
  readonly selected: boolean;
  /** False while a Form or a dialog has the keys; then the row does not take a click. */
  readonly active: boolean;
  /** The columns of the name and the key, so that the rows line up. */
  readonly labelWidth: number;
  readonly keyWidth: number;
  readonly onClick: () => void;
}

/** `select: a, b` for a select field, the type for all other fields. */
function describeType(field: CustomField): string {
  return field.type === "select" ? `select: ${field.options?.join(", ") ?? ""}` : field.type;
}

/** One Custom Field in the settings list: its name, its key and its type. */
export function CustomFieldRow({ field, selected, active, labelWidth, keyWidth, onClick }: CustomFieldRowProps) {
  return (
    <ColumnRow
      selected={selected}
      active={active}
      onClick={onClick}
      columns={[
        {
          width: labelWidth,
          content: (
            <Text color={theme.ink} bold={selected}>
              {field.label}
            </Text>
          ),
        },
        { width: keyWidth, content: <Text color={subtleColor(selected)}>{field.key}</Text> },
        {
          content: (
            <Text color={theme.inkMuted} wrap="truncate-end">
              {describeType(field)}
            </Text>
          ),
        },
      ]}
    />
  );
}
