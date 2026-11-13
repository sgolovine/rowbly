import { Text, useInput, usePaste } from "ink";
import { useRef } from "react";
import { useKeyCapture } from "../../hooks/index.js";
import { theme } from "../../theme.js";
import { editKey, follow, useEditState, WithCaret } from "../text-editing.js";

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

/**
 * A one-line text input: typing, `←/→`, `home`/`end` (`ctrl+a`/`ctrl+e`), `backspace` and `delete`.
 * While focused, the shell leaves printable keys to it; `enter`, `tab`, `↑/↓` and `esc` go to its parent.
 */
export function TextInput({ value, onChange, focus = true, width, placeholder, mask = false }: TextInputProps) {
  const [{ cursor }, apply, latest] = useEditState(value, onChange);
  useKeyCapture(focus);
  const offset = useRef(0);

  usePaste(
    (text) => {
      if (!text) return;
      const next = editKey(latest.current, text, {} as import("ink").Key, false);
      if (next) apply(next);
    },
    { isActive: focus },
  );

  useInput(
    (input, key) => {
      const next = editKey(latest.current, input, key, false);
      if (next) apply(next);
    },
    { isActive: focus },
  );

  // A masked value keeps its length, so the caret stays on the same column.
  const visible = mask ? "•".repeat(value.length) : value;
  if (!focus) {
    return <Text wrap="truncate-end">{visible || <Text color={theme.inkFaint}>{placeholder}</Text>}</Text>;
  }
  const size = width ?? value.length + 1;
  offset.current = follow(offset.current, cursor, size);
  const shown = visible.slice(offset.current, offset.current + size);
  return (
    <Text wrap="truncate-end">
      <WithCaret text={shown} at={cursor - offset.current} />
      {!value && placeholder && <Text color={theme.inkFaint}>{placeholder}</Text>}
    </Text>
  );
}
