import { Box, Text } from "ink";
import type { FormField } from "../Form/index.js";
import { SearchableSelect } from "../SearchableSelect/index.js";
import { Switch } from "../Switch/index.js";
import { TextArea } from "../TextArea/index.js";
import { TextInput } from "../TextInput/index.js";

type Raw = string | boolean | string[] | null;

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
      if (field.searchable)
        return (
          <SearchableSelect
            field={field}
            value={typeof raw === "string" ? raw : null}
            focused={focused}
            onChange={onChange}
          />
        );
      return <Text>{`‹ ${typeof raw === "string" ? (field.optionLabels?.[raw] ?? raw) : "—"} ›`}</Text>;
    case "multiselect": {
      const checked = Array.isArray(raw) ? raw : [];
      return (
        <Box columnGap={2} flexWrap="wrap">
          {(field.options ?? []).map((option, i) => (
            <Text key={option} underline={focused && i === optionCursor}>
              {checked.includes(option) ? "[x] " : "[ ] "}
              {field.optionLabels?.[option] ?? option}
            </Text>
          ))}
        </Box>
      );
    }
    case "multiline":
      return (
        <TextArea
          value={typeof raw === "string" ? raw : ""}
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
