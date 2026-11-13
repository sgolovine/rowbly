import type { StoryListRow } from "../story-list-rows.js";

/** The rows of the list that are on the screen, and the counts of the rows above and below them. */
export interface ListWindow {
  /** The list has more rows than its height. */
  readonly overflow: boolean;
  readonly start: number;
  readonly shown: number;
  readonly above: number;
  readonly below: number;
}

/** One item of the visible list: a row, or the gap where a dragged Story lands. */
export type ListItem =
  | { readonly kind: "row"; readonly row: StoryListRow; readonly index: number }
  | { readonly kind: "gap"; readonly index: number };

/** The window of `count` rows in `height` lines, around the `cursor`, with room for the gap at `slot`. */
export function listWindow(count: number, height: number | undefined, cursor: number, slot: number | null): ListWindow {
  const overflow = height !== undefined && count > height;
  // One row each for the `↑ n more` and `↓ n more` lines, when the list does not fit.
  const limit = overflow ? Math.max(1, height - 2) : count;
  const start = Math.max(0, Math.min(cursor - Math.floor(limit / 2), count - limit));
  // The gap takes a line, so the last row that fits leaves; the rows above it stay where they are.
  const shown = overflow && slot !== null && slot >= start && slot <= start + limit ? limit - 1 : limit;

  return { overflow, start, shown, above: start, below: count - start - shown };
}

/**
 * The visible rows of the window, with the gap before the row at `slot`. The items are one flat list, so that
 * a row keeps its place in the tree, and its mouse target, when the gap appears.
 */
export function visibleItems(rows: readonly StoryListRow[], view: ListWindow, slot: number | null): ListItem[] {
  return rows
    .slice(view.start, view.start + view.shown)
    .flatMap((row, i): ListItem[] => rowItems(row, view.start + i, slot));
}

function rowItems(row: StoryListRow, index: number, slot: number | null): ListItem[] {
  const item: ListItem = { kind: "row", row, index };

  return slot === index ? [{ kind: "gap", index }, item] : [item];
}
