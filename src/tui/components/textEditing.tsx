import { type Key, Text } from 'ink';
import { useReducer, useRef } from 'react';
import { theme } from '../theme';

/** Text being edited and its caret, an index into `value` (`value.length` is after the last character). */
export interface EditState {
  value: string;
  cursor: number;
}

/** One row of wrapped text: the slice `[start, end)` of the value, without its newline. */
export interface Row {
  start: number;
  end: number;
}

/** Splits `value` into rows of at most `width` characters, breaking at newlines and then at the width. */
export function wrapRows(value: string, width: number): Row[] {
  const w = Math.max(1, width);
  const rows: Row[] = [];
  let start = 0;
  for (const line of value.split('\n')) {
    const end = start + line.length;
    let at = start;
    do {
      rows.push({ start: at, end: Math.min(at + w, end) });
      at += w;
    } while (at < end);
    start = end + 1;
  }
  return rows;
}

/** The index of the row holding `cursor`. A caret on a wrap point belongs to the row it starts. */
export function rowOf(rows: readonly Row[], cursor: number): number {
  let r = 0;
  while (r + 1 < rows.length && (rows[r + 1]?.start ?? Infinity) <= cursor) r++;
  return r;
}

/** Moves the caret `delta` rows, keeping its column; null when there is no row there. */
export function moveRow(state: EditState, rows: readonly Row[], delta: -1 | 1): EditState | null {
  const r = rowOf(rows, state.cursor);
  const from = rows[r];
  const to = rows[r + delta];
  if (!from || !to) return null;
  return { ...state, cursor: Math.min(to.start + (state.cursor - from.start), to.end) };
}

function insert({ value, cursor }: EditState, text: string): EditState {
  return { value: value.slice(0, cursor) + text + value.slice(cursor), cursor: cursor + text.length };
}

function lineStart(value: string, cursor: number): number {
  return value.lastIndexOf('\n', cursor - 1) + 1;
}

function lineEnd(value: string, cursor: number): number {
  const at = value.indexOf('\n', cursor);
  return at === -1 ? value.length : at;
}

/**
 * Applies an editing key: typing (including pastes), `backspace`, `delete`, `←/→`, `home`/`end`
 * and `ctrl+a`/`ctrl+e` (start and end of the line). With `multiline`, `enter` inserts a newline and
 * pasted newlines are kept; otherwise they are dropped. Returns null for keys it does not handle,
 * such as `↑/↓`, `tab`, `esc` and other `ctrl` shortcuts, so the caller can act on them.
 */
export function editKey(state: EditState, input: string, key: Key, multiline: boolean): EditState | null {
  const { value, cursor } = state;
  if (key.return) return multiline && !key.ctrl && !key.meta ? insert(state, '\n') : null;
  if (key.backspace) {
    return cursor === 0 ? state : { value: value.slice(0, cursor - 1) + value.slice(cursor), cursor: cursor - 1 };
  }
  if (key.delete) return { value: value.slice(0, cursor) + value.slice(cursor + 1), cursor };
  if (key.leftArrow) return { value, cursor: Math.max(0, cursor - 1) };
  if (key.rightArrow) return { value, cursor: Math.min(value.length, cursor + 1) };
  if (key.home || (key.ctrl && input === 'a')) return { value, cursor: lineStart(value, cursor) };
  if (key.end || (key.ctrl && input === 'e')) return { value, cursor: lineEnd(value, cursor) };
  if (!input || key.ctrl || key.meta || key.escape || key.tab || key.upArrow || key.downArrow) return null;
  const text = input.replace(/\r\n?/g, '\n');
  return insert(state, multiline ? text : text.replaceAll('\n', ''));
}

/** Keeps `cursor` within `size` cells of a sticky scroll offset. */
export function follow(offset: number, cursor: number, size: number): number {
  return Math.max(cursor - size + 1, Math.min(offset, cursor));
}

/** `text` with the character at `at` (or a space after the end) shown as the caret. */
export function WithCaret({ text, at }: { text: string; at: number }) {
  return (
    <>
      {text.slice(0, at)}
      <Text backgroundColor={theme.accent} color={theme.onAccent}>
        {text[at] ?? ' '}
      </Text>
      {text.slice(at + 1)}
    </>
  );
}

/**
 * The text and caret of a controlled input. Keys are applied to the latest state rather than the last
 * render, so keys that arrive before a re-render (fast typing, held keys) all land. A `value` changed by
 * the parent replaces the text and keeps the caret within it.
 */
export function useEditState(value: string, onChange: (value: string) => void) {
  const latest = useRef<EditState>({ value, cursor: value.length });
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  if (latest.current.value !== value) {
    // A cursor at the end stays there when the text is set from outside, such as a key a Form fills from a name.
    const { cursor, value: old } = latest.current;
    latest.current = { value, cursor: cursor === old.length ? value.length : Math.min(cursor, value.length) };
  }
  const apply = (next: EditState) => {
    const changed = next.value !== latest.current.value;
    latest.current = next;
    rerender();
    if (changed) onChange(next.value);
  };
  return [latest.current, apply, latest] as const;
}
