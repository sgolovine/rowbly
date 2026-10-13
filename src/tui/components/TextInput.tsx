import { Text, useInput } from 'ink';
import { useRef } from 'react';
import { useKeyCapture } from '../hooks';
import { editKey, follow, useEditState, WithCaret } from './textEditing';

export interface TextInputProps {
  value: string;
  onChange(value: string): void;
  /** Takes keys and shows the caret. */
  focus?: boolean;
  /** Columns to show; longer text scrolls to keep the caret in view. */
  width?: number;
  /** Shown dimmed while the value is empty. */
  placeholder?: string;
}

/**
 * A one-line text input: typing, `←/→`, `home`/`end` (`ctrl+a`/`ctrl+e`), `backspace` and `delete`.
 * While focused, the shell leaves printable keys to it; `enter`, `tab`, `↑/↓` and `esc` go to its parent.
 */
export function TextInput({ value, onChange, focus = true, width, placeholder }: TextInputProps) {
  const [{ cursor }, apply, latest] = useEditState(value, onChange);
  useKeyCapture(focus);
  const offset = useRef(0);

  useInput(
    (input, key) => {
      const next = editKey(latest.current, input, key, false);
      if (next) apply(next);
    },
    { isActive: focus },
  );

  if (!focus) {
    return <Text wrap="truncate-end">{value || <Text dimColor>{placeholder}</Text>}</Text>;
  }
  const size = width ?? value.length + 1;
  offset.current = follow(offset.current, cursor, size);
  const shown = value.slice(offset.current, offset.current + size);
  return (
    <Text wrap="truncate-end">
      <WithCaret text={shown} at={cursor - offset.current} />
      {!value && placeholder && <Text dimColor>{placeholder}</Text>}
    </Text>
  );
}
