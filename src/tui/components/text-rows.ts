import { Store } from "../../services/store/store.js";

/** The row that a word wrap fills now. */
interface WrapState {
  readonly row: string;
}

/** `chars` in groups of `width`; no characters give one empty row. */
function chunkRows(chars: readonly string[], width: number): string[] {
  const count = Math.max(1, Math.ceil(chars.length / width));

  return Array.from({ length: count }, (_, index) => chars.slice(index * width, (index + 1) * width).join(""));
}

/** Rows of plain text of at most `width` characters, with the line breaks of the text. */
export function plainRows(text: string, width: number): string[] {
  const size = Math.max(1, width);

  return text.split("\n").flatMap((line) => chunkRows(Array.from(line), size));
}

/**
 * Adds `word` to the row of `wrap`, and gives the rows that it completes. A word longer than the row
 * breaks at the width. The store keeps the work linear in the length of the line.
 */
function addWord(wrap: Store<WrapState>, word: string, width: number): string[] {
  const { row } = wrap.current;
  const next = row ? `${row} ${word}` : word;

  if (Array.from(next).length <= width) {
    wrap.update(() => ({ row: next }));

    return [];
  }

  const chunks = chunkRows(Array.from(word), width);

  wrap.update(() => ({ row: chunks.at(-1) ?? "" }));

  return [...(row ? [row] : []), ...chunks.slice(0, -1)];
}

/** The rows of one line of prose. */
function lineWordRows(line: string, width: number): string[] {
  const wrap = new Store<WrapState>({ row: "" });
  const done = line.split(" ").flatMap((word) => addWord(wrap, word, width));

  return [...done, wrap.current.row];
}

/** Rows of prose of at most `width` characters, broken between words where a word fits on a row. */
export function wordRows(text: string, width: number): string[] {
  const size = Math.max(1, width);

  return text.split("\n").flatMap((line) => lineWordRows(line, size));
}
