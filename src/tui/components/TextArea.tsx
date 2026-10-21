import { Box, Text, useInput } from 'ink';
import { useRef } from 'react';
import { useKeyCapture } from '../hooks';
import { theme } from '../theme';
import { FullScreenButton } from './FullScreenButton';
import { editKey, follow, moveRow, rowOf, useEditState, WithCaret, wrapRows } from './textEditing';
import { useFullScreenEditor } from './useFullScreenEditor';

export interface TextAreaProps {
  value: string;
  onChange(value: string): void;
  /** Takes keys and shows the caret. */
  focus?: boolean;
  /** Columns available; lines longer than this wrap. */
  width: number;
  /** Rows shown; more text scrolls to keep the caret in view. */
  rows?: number;
  /** Shown dimmed while the value is empty. */
  placeholder?: string;
  /** Called when `↑` on the first row or `↓` on the last would move the caret out of the text. */
  onLeave?(direction: -1 | 1): void;
  /** Shows a Full screen button below the text, and `ctrl+f` opens the text in a `FullScreenEditor`. Defaults to true. */
  expandable?: boolean;
  /** The full-screen editor's title. */
  title?: string;
}

/**
 * A multi-line text input: `enter` starts a new line, `↑/↓` move between rows, and the editing keys of
 * `TextInput` work within a line. While focused, the shell leaves printable keys to it; `tab`, `ctrl+enter` and `esc` go to its parent.
 * Its Full screen button (or `ctrl+f`) opens the text in a `FullScreenEditor` over the whole terminal, in
 * edit mode; every edit there goes to `onChange`, so closing it keeps the text.
 */
export function TextArea({
  value,
  onChange,
  focus = true,
  width,
  rows = 5,
  placeholder,
  onLeave,
  expandable = true,
  title = 'Edit text',
}: TextAreaProps) {
  const [{ cursor }, apply, latest] = useEditState(value, onChange);
  const editor = useFullScreenEditor();
  const expanded = editor.isOpen;
  const editing = focus && !expanded;
  useKeyCapture(editing);
  const top = useRef(0);
  // One column is kept free so the caret fits after a full row.
  const rowsOf = (text: string) => wrapRows(text, width - 1);
  const wrapped = rowsOf(value);

  // The editor holds the text once it opens, and reports every edit to the latest `onChange`.
  const report = useRef(onChange);
  report.current = onChange;
  const expand = () =>
    editor.open({ title, initial: latest.current.value, mode: 'edit', onChange: (next) => report.current(next) });

  useInput(
    (input, key) => {
      const state = latest.current;
      if (expandable && key.ctrl && input === 'f') {
        expand();
        return;
      }
      if (key.upArrow || key.downArrow) {
        const direction = key.upArrow ? -1 : 1;
        const next = moveRow(state, rowsOf(state.value), direction);
        if (next) apply(next);
        else onLeave?.(direction);
        return;
      }
      const next = editKey(state, input, key, true);
      if (next) apply(next);
    },
    { isActive: editing },
  );

  const current = rowOf(wrapped, cursor);
  top.current = follow(top.current, current, rows);
  const text = (
    <Box flexDirection="column" height={rows} flexShrink={0} overflow="hidden">
      {!value && !editing ? (
        <Text color={theme.inkFaint}>{placeholder}</Text>
      ) : (
        wrapped.slice(top.current, top.current + rows).map((row, i) => {
          const text = value.slice(row.start, row.end);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity beyond their position.
            <Text key={i} wrap="truncate-end">
              {/* An empty Text has no height, so a blank line holds a space to keep its row. */}
              {editing && top.current + i === current ? <WithCaret text={text} at={cursor - row.start} /> : text || ' '}
              {editing && !value && placeholder && <Text color={theme.inkFaint}>{placeholder}</Text>}
            </Text>
          );
        })
      )}
    </Box>
  );
  if (!expandable) return text;
  return (
    <Box flexDirection="column" flexShrink={0}>
      {text}
      <FullScreenButton focused={focus} clickable={!expanded} onClick={expand} />
      {/* Outside the shell there is nothing to cover, so the editor shows here. */}
      {editor.inline}
    </Box>
  );
}
