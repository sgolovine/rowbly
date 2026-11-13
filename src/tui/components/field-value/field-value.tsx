import { Box, Text } from "ink";
import type { FormField } from "../form/index.js";
import { SearchableSelect } from "../searchable-select/index.js";
import { Switch } from "../switch/index.js";
import { TextArea } from "../text-area/index.js";
import { TextInput } from "../text-input/index.js";

type Raw = string | boolean | string[] | null;

/** What a select that cycles shows: the label of the choice, or `—` for no choice. */
function selectText(field: FormField, raw: Raw): string {
  return `‹ ${typeof raw === "string" ? (field.optionLabels?.[raw] ?? raw) : "—"} ›`;
}

function stringOrNull(raw: Raw): string | null {
  return typeof raw === "string" ? raw : null;
}

function checkedOptions(raw: Raw): readonly string[] {
  return Array.isArray(raw) ? raw : [];
}

/** The input of one `Form` field, for its kind: a toggle, a switch, a select, options, a text area or a text input. */
export function FieldValue({
  field,
  raw,
  focused,
  optionCursor,
  width,
  onChange,
  onLeave,
}: {
  field: FormField;
  raw: Raw;
  focused: boolean;
  optionCursor: number;
  width: number;
  onChange(raw: Raw): void;
  onLeave(direction: -1 | 1): void;
}) {
  switch (field.kind) {
    case "boolean":
      return <Text>{raw === true ? "[x] yes" : "[ ] no"}</Text>;
    case "switch":
      return (
        <Switch
          on={raw === true}
          onLabel={field.switchLabels?.on}
          offLabel={field.switchLabels?.off}
          onChange={onChange}
        />
      );
    case "select":
      return field.searchable ? (
        <SearchableSelect field={field} value={stringOrNull(raw)} focused={focused} onChange={onChange} />
      ) : (
        <Text>{selectText(field, raw)}</Text>
      );
    case "multiselect":
      return (
        <Box columnGap={2} flexWrap="wrap">
          {(field.options ?? []).map((option, i) => (
            <Text key={option} underline={focused && i === optionCursor}>
              {checkedOptions(raw).includes(option) ? "[x] " : "[ ] "}
              {field.optionLabels?.[option] ?? option}
            </Text>
          ))}
        </Box>
      );
    case "multiline":
      return (
        <TextArea
          value={stringOrNull(raw) ?? ""}
          onChange={onChange}
          focus={focused}
          width={width}
          rows={5}
          placeholder="(empty)"
          onLeave={onLeave}
          title={field.label}
        />
      );
    default:
      return (
        <TextInput
          value={String(raw)}
          onChange={onChange}
          focus={focused}
          width={width}
          placeholder={field.kind === "date" ? "YYYY-MM-DD" : undefined}
        />
      );
  }
}
