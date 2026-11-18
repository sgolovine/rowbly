import { Box, type Key, Text } from "ink";
import { type Dispatch, type RefObject, type SetStateAction, useState } from "react";
import { useLatest } from "../../hooks/index.js";
import { theme } from "../../theme.js";
import type { FormField } from "../form/index.js";
import { usePickerField } from "../searchable-select-picker/index.js";
import { AddOptionButton } from "./add-option-button.js";
import { MultiSelectItem } from "./multi-select-item.js";

interface SearchableMultiSelectProps {
  field: FormField;
  value: readonly string[];
  /** The field has the focus and takes the keys. */
  focused: boolean;
  /** The form takes clicks. */
  clickable: boolean;
  onChange(value: string[]): void;
}

/** What the keys and the clicks use: the value, the cursor and the setters. */
interface MultiSelectEnv {
  readonly value: readonly string[];
  readonly cursor: number;
  readonly setCursor: Dispatch<SetStateAction<number>>;
  readonly report: RefObject<(value: string[]) => void>;
}

/** The options that the picker shows: the options of the field that are not chosen. */
function pickerOptions(field: FormField, value: readonly string[]): string[] {
  return (field.options ?? []).filter((option) => !value.includes(option));
}

function removeOption(env: MultiSelectEnv, option: string | undefined): void {
  if (option === undefined) {
    return;
  }

  env.report.current(env.value.filter((chosen) => chosen !== option));
  env.setCursor((cursor) => Math.max(0, Math.min(cursor, env.value.length - 2)));
}

/** `←/→` move the cursor and `backspace` removes the chosen option. The picker field handles the other keys. */
function multiSelectKey(env: MultiSelectEnv, key: Key): void {
  if (key.backspace || key.delete) {
    removeOption(env, env.value[env.cursor]);

    return;
  }

  if (key.leftArrow || key.rightArrow) {
    env.setCursor((cursor) => Math.max(0, Math.min(env.value.length - 1, cursor + (key.rightArrow ? 1 : -1))));
  }
}

/**
 * The chosen options of a searchable `multiselect` field, one on each line. `enter` or typed text opens a fuzzy
 * picker that adds one option. `←/→` select a chosen option and `backspace` removes it. A click on `✕` removes an
 * option, and a click on `+ add` opens the picker.
 */
export function SearchableMultiSelect({ field, value, focused, clickable, onChange }: SearchableMultiSelectProps) {
  const [cursor, setCursor] = useState(0);
  const report = useLatest(onChange);

  const selected = Math.min(cursor, Math.max(0, value.length - 1));
  const env: MultiSelectEnv = { value, cursor: selected, setCursor, report };
  const { picker, inline, open } = usePickerField({
    field,
    options: pickerOptions(field, value),
    value: null,
    title: `Add ${field.label}`,
    verb: "add",
    hideSelected: true,
    focused,
    onPick: (option) => onChange([...value, option]),
    onOtherKey: (_input, key) => multiSelectKey(env, key),
  });

  return (
    <Box flexDirection="column" flexGrow={1}>
      {value.length === 0 && <Text color={theme.inkFaint}>none</Text>}
      {value.map((option, index) => (
        <MultiSelectItem
          key={option}
          label={field.optionLabels?.[option] ?? option}
          highlighted={focused && index === selected}
          clickable={clickable && !picker}
          onRemove={() => removeOption(env, option)}
        />
      ))}
      <AddOptionButton clickable={clickable && !picker} onClick={() => open("")} />
      {inline}
    </Box>
  );
}
