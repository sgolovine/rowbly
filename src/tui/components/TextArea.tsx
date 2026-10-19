import { Box, Text, useInput } from 'ink';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useKeyCapture, useMainOverlay } from '../hooks';
import { FullScreenButton } from './FullScreenButton';
import { TextAreaModal } from './TextAreaModal';
import { editKey, follow, moveRow, rowOf, useEditState, WithCaret, wrapRows } from './textEditing';

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
  /** Shows a Full screen button below the text, and `ctrl+f` opens the text in a modal. Defaults to true. */
  expandable?: boolean;
  /** The full-screen modal's title. */
  title?: string;
}

/**
 * A multi-line text input: `enter` starts a new line, `↑/↓` move between rows, and the editing keys of
 * `TextInput` work within a line. While focused, the shell leaves printable keys to it; `tab`, `ctrl+enter` and `esc` go to its parent.
 * Its Full screen button (or `ctrl+f`) opens the text in a modal over the main area, which keeps every
 * edit when it closes.
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
  const [expanded, setExpanded] = useState(false);
  const editing = focus && !expanded;
  useKeyCapture(editing);
  const top = useRef(0);
  // One column is kept free so the caret fits after a full row.
  const rowsOf = (text: string) => wrapRows(text, width - 1);
  const wrapped = rowsOf(value);

  // The modal is built when it opens: it holds the text from then on and reports every edit.
  const overlay = useMainOverlay();
  const id = useId();
  const report = useRef(onChange);
  report.current = onChange;
  const modal = useRef<ReactNode>(null);
  const expand = () => {
    modal.current = (
      <TextAreaModal
        title={title}
        initial={latest.current.value}
        onChange={(next) => report.current(next)}
        onClose={() => setExpanded(false)}
      />
    );
    setExpanded(true);
  };
  useEffect(() => {
    if (!expanded || !overlay) return;
    overlay.open(id, modal.current);
    return () => overlay.close(id);
  }, [expanded, overlay, id]);

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
        <Text dimColor>{placeholder}</Text>
      ) : (
        wrapped.slice(top.current, top.current + rows).map((row, i) => {
          const text = value.slice(row.start, row.end);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity beyond their position.
            <Text key={i} wrap="truncate-end">
              {/* An empty Text has no height, so a blank line holds a space to keep its row. */}
              {editing && top.current + i === current ? <WithCaret text={text} at={cursor - row.start} /> : text || ' '}
              {editing && !value && placeholder && <Text dimColor>{placeholder}</Text>}
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
      {/* Outside the shell there is no main area to cover, so the modal shows here. */}
      {expanded && !overlay && modal.current}
    </Box>
  );
}
