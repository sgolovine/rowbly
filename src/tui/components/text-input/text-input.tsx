import { type Key, Text, useInput, usePaste } from "ink";
import { type RefObject, useRef } from "react";
import { useKeyCapture, writeRef } from "../../hooks/index.js";
import { theme } from "../../theme.js";
import { type EditState, editKey, follow } from "../text-editing.js";
import { useEditState } from "../use-edit-state.js";
import { WithCaret } from "../with-caret/index.js";

export interface TextInputProps {
  value: string;
  onChange(value: string): void;
  /** Takes keys and shows the caret. */
  focus?: boolean;
  /** Columns to show; longer text scrolls to keep the caret in view. */
  width?: number;
  /** Shown dimmed while the value is empty. */
  placeholder?: string;
  /** Shows a `•` for each character, for a secret such as an API key. */
  mask?: boolean;
}

interface TextInputEnv {
  readonly latest: RefObject<EditState>;
  readonly apply: (next: EditState) => void;
}

/** Applies a paste or a key to the latest state, so that a burst of keys before a re-render all land. */
function applyInput(env: TextInputEnv, input: string, key: Key): void {
  const next = editKey(env.latest.current, input, key, false);

  if (next) {
    env.apply(next);
  }
}

/**
 * A one-line text input: typing, `←/→`, `home`/`end` (`ctrl+a`/`ctrl+e`), `backspace` and `delete`.
 * While focused, the shell leaves printable keys to it; `enter`, `tab`, `↑/↓` and `esc` go to its parent.
 */
export function TextInput({ value, onChange, focus = true, width, placeholder, mask = false }: TextInputProps) {
  const [{ cursor }, apply, latest] = useEditState(value, onChange);
  useKeyCapture(focus);
  const offset = useRef(0);

  const env: TextInputEnv = { latest, apply };
  // A masked value keeps its length, so the caret stays on the same column.
  const visible = mask ? "•".repeat(value.length) : value;
  const size = width ?? value.length + 1;

  usePaste((text) => applyInput(env, text, {} as Key), { isActive: focus });
  useInput((input, key) => applyInput(env, input, key), { isActive: focus });

  if (!focus) {
    return <Text wrap="truncate-end">{visible || <Text color={theme.inkFaint}>{placeholder}</Text>}</Text>;
  }

  writeRef(offset, follow(offset.current, cursor, size));

  const shown = visible.slice(offset.current, offset.current + size);

  return (
    <Text wrap="truncate-end">
      <WithCaret text={shown} at={cursor - offset.current} />
      {!value && placeholder && <Text color={theme.inkFaint}>{placeholder}</Text>}
    </Text>
  );
}
