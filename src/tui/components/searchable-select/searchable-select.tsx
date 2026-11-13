import { type Key, Text, useInput } from "ink";
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
import type { FormField } from "../form/index.js";
import { Modal } from "../modal/index.js";
import { LayerWrapContext } from "../modal-layer.js";
import { SearchableSelectPicker } from "../searchable-select-picker/index.js";

interface SearchableSelectProps {
  field: FormField;
  value: string | null;
  focused: boolean;
  onChange(value: string): void;
}

/** What opens the picker: the field, the wrap of the layer, the setter of the picker and the latest `onChange`. */
interface PickerEnv {
  readonly field: FormField;
  readonly value: string | null;
  readonly wrap: (node: ReactNode) => ReactNode;
  readonly setPicker: Dispatch<SetStateAction<ReactNode>>;
  readonly report: RefObject<(value: string) => void>;
}

const PICKER_HINTS: readonly KeyHint[] = [
  { key: "enter", description: "choose" },
  { key: "↑/↓", description: "select" },
  { key: "ctrl+l", description: "clear query" },
  { key: "esc", description: "cancel" },
];

function chooseOption(env: PickerEnv, option: string): void {
  env.report.current(option);
  env.setPicker(null);
}

/** Opens the picker with `query` as its first query. */
function openPicker(env: PickerEnv, query: string): void {
  const { field, setPicker } = env;

  setPicker(
    env.wrap(
      <Modal title={`Find ${field.label}`} onClose={() => setPicker(null)} hints={PICKER_HINTS}>
        <SearchableSelectPicker
          options={field.options ?? []}
          labels={field.optionLabels}
          searchText={field.optionSearchText}
          initialQuery={query}
          value={env.value}
          onSelect={(option) => chooseOption(env, option)}
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

/** `enter` opens the picker with no query; typed text opens it with the text as the query. */
function selectKey(env: PickerEnv, input: string, key: Key): void {
  if (key.ctrl || key.meta) {
    return;
  }

  if (key.return) {
    openPicker(env, "");

    return;
  }

  if (isQueryText(input, key)) {
    openPicker(env, input);
  }
}

function valueText(field: FormField, value: string | null): string {
  return !value ? "—" : (field.optionLabels?.[value] ?? value);
}

/** The query belongs to the picker; only choosing an option changes the Form's value. */
export function SearchableSelect({ field, value, focused, onChange }: SearchableSelectProps) {
  const overlay = useMainOverlay();
  const wrap = useContext(LayerWrapContext);
  const id = useId();
  const [picker, setPicker] = useState<ReactNode>(null);
  const report = useLatest(onChange);

  const env: PickerEnv = { field, value, wrap, setPicker, report };

  // A picker opened from a short task needs the terminal's room, not that task's clipped body.
  useEffect(() => {
    if (!picker || !overlay) {
      return;
    }

    overlay.open(id, picker);

    return () => overlay.close(id);
  }, [picker, overlay, id]);
  useKeyCapture(focused && !picker);
  useInput((input, key) => selectKey(env, input, key), { isActive: focused && !picker });

  return (
    <>
      <Text wrap="truncate-end">{valueText(field, value)}</Text>
      {!overlay && picker}
    </>
  );
}
