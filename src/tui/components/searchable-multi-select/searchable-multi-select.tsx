import { Box, type Key, Text, useInput } from "ink";
import {
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  useContext,
  useEffect,
  useId,
  useState,
} from "react";
import { useKeyCapture, useLatest, useMainOverlay } from "../../hooks/index.js";
import type { KeyHint } from "../../keymap.js";
import { theme } from "../../theme.js";
import type { FormField } from "../form/index.js";
import { Modal } from "../modal/index.js";
import { LayerWrapContext } from "../modal-layer.js";
import { SearchableSelectPicker } from "../searchable-select-picker/index.js";
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

/** What the keys, the clicks and the picker use: the field, its value, the cursor and the setters. */
interface MultiSelectEnv {
  readonly field: FormField;
  readonly value: readonly string[];
  readonly cursor: number;
  readonly setCursor: Dispatch<SetStateAction<number>>;
  readonly wrap: (node: ReactNode) => ReactNode;
  readonly setPicker: Dispatch<SetStateAction<ReactNode>>;
  readonly report: RefObject<(value: string[]) => void>;
}

const PICKER_HINTS: readonly KeyHint[] = [
  { key: "enter", description: "add" },
  { key: "↑/↓", description: "select" },
  { key: "ctrl+l", description: "clear query" },
  { key: "esc", description: "cancel" },
];

/** The options that the picker shows: the options of the field that are not chosen. */
function pickerOptions(field: FormField, value: readonly string[]): string[] {
  return (field.options ?? []).filter((option) => !value.includes(option));
}

function addOption(env: MultiSelectEnv, option: string): void {
  env.report.current([...env.value, option]);
  env.setPicker(null);
}

function removeOption(env: MultiSelectEnv, option: string | undefined): void {
  if (option === undefined) {
    return;
  }

  env.report.current(env.value.filter((chosen) => chosen !== option));
  env.setCursor((cursor) => Math.max(0, Math.min(cursor, env.value.length - 2)));
}

/** Opens the picker with `query` as its first query. */
function openPicker(env: MultiSelectEnv, query: string): void {
  const { field, setPicker } = env;

  setPicker(
    env.wrap(
      <Modal title={`Add ${field.label}`} onClose={() => setPicker(null)} hints={PICKER_HINTS}>
        <SearchableSelectPicker
          options={pickerOptions(field, env.value)}
          labels={field.optionLabels}
          searchText={field.optionSearchText}
          initialQuery={query}
          value={null}
          hideSelected
          onSelect={(option) => addOption(env, option)}
          onCancel={() => setPicker(null)}
        />
      </Modal>,
    ),
  );
}

/** A key that types text into the query, not a key that moves or edits. */
function isQueryText(input: string, key: Key): boolean {
  const moves = key.upArrow || key.downArrow || key.leftArrow || key.rightArrow;

  return Boolean(input) && !key.escape && !key.tab && !moves && !key.backspace && !key.delete;
}

/** `enter` opens the picker, typed text opens it with a query, `←/→` move and `backspace` removes. */
function multiSelectKey(env: MultiSelectEnv, input: string, key: Key): void {
  if (key.ctrl || key.meta) {
    return;
  }

  if (key.return) {
    openPicker(env, "");

    return;
  }

  if (key.backspace || key.delete) {
    removeOption(env, env.value[env.cursor]);

    return;
  }

  if (key.leftArrow || key.rightArrow) {
    env.setCursor((cursor) => Math.max(0, Math.min(env.value.length - 1, cursor + (key.rightArrow ? 1 : -1))));

    return;
  }

  if (isQueryText(input, key)) {
    openPicker(env, input);
  }
}

/**
 * The chosen options of a searchable `multiselect` field, one on each line. `enter` or typed text opens a fuzzy
 * picker that adds one option. `←/→` select a chosen option and `backspace` removes it. A click on `✕` removes an
 * option, and a click on `+ add` opens the picker.
 */
export function SearchableMultiSelect({ field, value, focused, clickable, onChange }: SearchableMultiSelectProps) {
  const overlay = useMainOverlay();
  const wrap = useContext(LayerWrapContext);
  const id = useId();
  const [picker, setPicker] = useState<ReactNode>(null);
  const [cursor, setCursor] = useState(0);
  const report = useLatest(onChange);

  const selected = Math.min(cursor, Math.max(0, value.length - 1));
  const env: MultiSelectEnv = { field, value, cursor: selected, setCursor, wrap, setPicker, report };

  // A picker opened from a short task needs the terminal's room, not that task's clipped body.
  useEffect(() => {
    if (!picker || !overlay) {
      return;
    }

    overlay.open(id, picker);

    return () => overlay.close(id);
  }, [picker, overlay, id]);
  useKeyCapture(focused && !picker);
  useInput((input, key) => multiSelectKey(env, input, key), { isActive: focused && !picker });

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
      <AddOptionButton clickable={clickable && !picker} onClick={() => openPicker(env, "")} />
      {!overlay && picker}
    </Box>
  );
}
