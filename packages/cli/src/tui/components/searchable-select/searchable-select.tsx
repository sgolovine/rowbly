import { Text } from "ink";
import type { FormField } from "../form/index.js";
import { usePickerField } from "../searchable-select-picker/index.js";

interface SearchableSelectProps {
  field: FormField;
  value: string | null;
  focused: boolean;
  onChange(value: string): void;
}

function valueText(field: FormField, value: string | null): string {
  return !value ? "—" : (field.optionLabels?.[value] ?? value);
}

/** The query belongs to the picker; only choosing an option changes the Form's value. */
export function SearchableSelect({ field, value, focused, onChange }: SearchableSelectProps) {
  const { inline } = usePickerField({
    field,
    options: field.options ?? [],
    value,
    title: `Find ${field.label}`,
    verb: "choose",
    focused,
    onPick: onChange,
  });

  return (
    <>
      <Text wrap="truncate-end">{valueText(field, value)}</Text>
      {inline}
    </>
  );
}
