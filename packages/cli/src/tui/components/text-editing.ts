import type { Key } from "ink";

/** Text being edited and its caret, an index into `value` (`value.length` is after the last character). */
export interface EditState {
  readonly value: string;
  readonly cursor: number;
}

/** One row of wrapped text: the slice `[start, end)` of the value, without its newline. */
export interface Row {
  readonly start: number;
  readonly end: number;
}

/** Splits `value` into rows of at most `width` characters, breaking at newlines and then at the width. */
export function wrapRows(value: string, width: number): Row[] {
  const size = Math.max(1, width);
  const lines = value.split("\n");
  const starts = [0, ...[...value.matchAll(/\n/g)].map((match) => match.index + 1)];

  return lines.flatMap((line, index) => lineRows(starts[index] ?? 0, line.length, size));
}

/** The rows of one line: an empty line still has one row. */
function lineRows(start: number, length: number, size: number): Row[] {
  const count = Math.max(1, Math.ceil(length / size));
  const end = start + length;

  return Array.from({ length: count }, (_, index) => ({
    start: start + index * size,
    end: Math.min(start + (index + 1) * size, end),
  }));
}

/** The index of the row holding `cursor`. A caret on a wrap point belongs to the row it starts. */
export function rowOf(rows: readonly Row[], cursor: number): number {
  const after = rows.findIndex((row, index) => index > 0 && row.start > cursor);

  return after === -1 ? Math.max(0, rows.length - 1) : after - 1;
}

/** Moves the caret `delta` rows, keeping its column; null when there is no row there. */
export function moveRow(state: EditState, rows: readonly Row[], delta: -1 | 1): EditState | null {
  const r = rowOf(rows, state.cursor);
  const from = rows[r];
  const to = rows[r + delta];

  if (!from || !to) {
    return null;
  }

  return { ...state, cursor: Math.min(to.start + (state.cursor - from.start), to.end) };
}

function insert({ value, cursor }: EditState, text: string): EditState {
  return { value: value.slice(0, cursor) + text + value.slice(cursor), cursor: cursor + text.length };
}

function lineStart(value: string, cursor: number): number {
  return value.lastIndexOf("\n", cursor - 1) + 1;
}

function lineEnd(value: string, cursor: number): number {
  const at = value.indexOf("\n", cursor);

  return at === -1 ? value.length : at;
}

/**
 * Applies an editing key: typing (including pastes), `backspace`, `delete`, `←/→`, `home`/`end`
 * and `ctrl+a`/`ctrl+e` (start and end of the line). With `multiline`, `enter` inserts a newline and
 * pasted newlines are kept; otherwise they are dropped. Returns null for keys it does not handle,
 * such as `↑/↓`, `tab`, `esc` and other `ctrl` shortcuts, so the caller can act on them.
 */
export function editKey(state: EditState, input: string, key: Key, multiline: boolean): EditState | null {
  if (key.return) {
    return multiline && !key.ctrl && !key.meta ? insert(state, "\n") : null;
  }

  return deleteKey(state, key) ?? caretKey(state, input, key) ?? typedText(state, input, key, multiline);
}

/** `backspace` and `delete`; undefined for other keys. */
function deleteKey(state: EditState, key: Key): EditState | undefined {
  const { value, cursor } = state;

  if (key.backspace) {
    return cursor === 0 ? state : { value: value.slice(0, cursor - 1) + value.slice(cursor), cursor: cursor - 1 };
  }

  if (key.delete) {
    return { value: value.slice(0, cursor) + value.slice(cursor + 1), cursor };
  }

  return undefined;
}

/** The keys that move the caret within a line; undefined for other keys. */
function caretKey({ value, cursor }: EditState, input: string, key: Key): EditState | undefined {
  if (key.leftArrow) {
    return { value, cursor: Math.max(0, cursor - 1) };
  }

  if (key.rightArrow) {
    return { value, cursor: Math.min(value.length, cursor + 1) };
  }

  if (key.home || (key.ctrl && input === "a")) {
    return { value, cursor: lineStart(value, cursor) };
  }

  if (key.end || (key.ctrl && input === "e")) {
    return { value, cursor: lineEnd(value, cursor) };
  }

  return undefined;
}

/** Typed or pasted text; null for a key that is a shortcut and not text. */
function typedText(state: EditState, input: string, key: Key, multiline: boolean): EditState | null {
  if (!input || key.ctrl || key.meta || key.escape || key.tab || key.upArrow || key.downArrow) {
    return null;
  }

  const text = input.replace(/\r\n?/g, "\n");

  return insert(state, multiline ? text : text.replaceAll("\n", ""));
}

/** Keeps `cursor` within `size` cells of a sticky scroll offset. */
export function follow(offset: number, cursor: number, size: number): number {
  return Math.max(cursor - size + 1, Math.min(offset, cursor));
}
