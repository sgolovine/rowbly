import { type Key, useInput } from "ink";
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
import { SearchableSelectPicker } from "./searchable-select-picker.js";

/** The settings of a field that opens a `SearchableSelectPicker` in a Modal. */
interface PickerFieldOptions {
  readonly field: FormField;
  /** The options that the picker shows. */
  readonly options: readonly string[];
  /** The option that the picker marks as chosen, or `null`. */
  readonly value: string | null;
  /** The title of the Modal. */
  readonly title: string;
  /** The description of the `enter` hint, for example "choose" or "add". */
  readonly verb: string;
  readonly hideSelected?: boolean;
  /** The field has the focus and takes the keys. */
  readonly focused: boolean;
  /** Receives the chosen option. The picker closes after it. */
  onPick(option: string): void;
  /** Receives each key that does not open the picker, without `ctrl` and `meta`. */
  onOtherKey?(input: string, key: Key): void;
}

/** What the field renders and calls: the open picker, the node to render in the field and the opener. */
interface PickerField {
  /** The open picker, or `null`. */
  readonly picker: ReactNode;
  /** The picker to render in the field: `null` when the main overlay shows it. */
  readonly inline: ReactNode;
  /** Opens the picker with `query` as its first query. */
  readonly open: (query: string) => void;
}

/** What opens the picker: the settings at open time, the wrap of the layer, the setter and the latest callbacks. */
interface PickerFieldEnv {
  readonly options: PickerFieldOptions;
  readonly wrap: (node: ReactNode) => ReactNode;
  readonly setPicker: Dispatch<SetStateAction<ReactNode>>;
  readonly pick: RefObject<(option: string) => void>;
}

function pickerHints(verb: string): readonly KeyHint[] {
  return [
    { key: "enter", description: verb },
    { key: "↑/↓", description: "select" },
    { key: "ctrl+l", description: "clear query" },
    { key: "esc", description: "cancel" },
  ];
}

function chooseOption(env: PickerFieldEnv, option: string): void {
  env.pick.current(option);
  env.setPicker(null);
}

function openPicker(env: PickerFieldEnv, query: string): void {
  const { options, setPicker } = env;

  setPicker(
    env.wrap(
      <Modal title={options.title} onClose={() => setPicker(null)} hints={pickerHints(options.verb)}>
        <SearchableSelectPicker
          options={options.options}
          labels={options.field.optionLabels}
          searchText={options.field.optionSearchText}
          initialQuery={query}
          value={options.value}
          hideSelected={options.hideSelected}
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

/** `enter` opens the picker with no query; typed text opens it with the text as the query. Other keys go to the field. */
function pickerFieldKey(env: PickerFieldEnv, input: string, key: Key): void {
  if (key.ctrl || key.meta) {
    return;
  }

  if (key.return) {
    openPicker(env, "");

    return;
  }

  if (isQueryText(input, key)) {
    openPicker(env, input);

    return;
  }

  env.options.onOtherKey?.(input, key);
}

/** The shared logic of a field that opens a fuzzy picker: the keys, the picker state and the main overlay. */
export function usePickerField(options: PickerFieldOptions): PickerField {
  const overlay = useMainOverlay();
  const wrap = useContext(LayerWrapContext);
  const id = useId();
  const [picker, setPicker] = useState<ReactNode>(null);
  const pick = useLatest(options.onPick);

  const env: PickerFieldEnv = { options, wrap, setPicker, pick };
  const active = options.focused && !picker;

  // A picker opened from a short task needs the terminal's room, not that task's clipped body.
  useEffect(() => {
    if (!picker || !overlay) {
      return;
    }

    overlay.open(id, picker);

    return () => overlay.close(id);
  }, [picker, overlay, id]);
  useKeyCapture(active);
  useInput((input, key) => pickerFieldKey(env, input, key), { isActive: active });

  return { picker, inline: overlay ? null : picker, open: (query) => openPicker(env, query) };
}
