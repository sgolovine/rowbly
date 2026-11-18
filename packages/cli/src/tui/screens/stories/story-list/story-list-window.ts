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

/**
 * The window of `count` rows in `height` lines, around the `cursor`, with room for the gap at `slot`. When the
 * list does not fit, a `↑ n more` line shows only when rows are above the window, and a `↓ n more` line shows
 * only when rows are below it. The rows use all the other lines.
 */
export function listWindow(count: number, height: number | undefined, cursor: number, slot: number | null): ListWindow {
  if (height === undefined || count <= height) {
    return { overflow: false, start: 0, shown: count, above: 0, below: 0 };
  }

  const { start, limit } = windowRange(count, height, cursor);
  const gap = slot !== null && slot >= start && slot <= start + limit;
  // The gap takes a line, so the last rows that fit leave; the rows above them stay where they are. A row leaves,
  // so a `↓ n more` line shows below the rows.
  const shown = gap ? Math.max(1, height - 2 - (start > 0 ? 1 : 0)) : limit;

  return { overflow: true, start, shown, above: start, below: count - start - shown };
}

/** The first row and the number of rows of a list that does not fit, with one line for each indicator line. */
function windowRange(
  count: number,
  height: number,
  cursor: number,
): { readonly start: number; readonly limit: number } {
  // Only one indicator line shows when the window is at the top or at the end of the list.
  const edge = Math.max(1, height - 1);
  const edgeStart = centredStart(count, edge, cursor);

  if (edgeStart === 0 || edgeStart + edge >= count) {
    return { start: edgeStart, limit: edge };
  }

  const limit = Math.max(1, height - 2);

  return { start: centredStart(count, limit, cursor), limit };
}

/** The first row of a window of `limit` rows, centred on the `cursor` and inside the list. */
function centredStart(count: number, limit: number, cursor: number): number {
  return Math.max(0, Math.min(cursor - Math.floor(limit / 2), count - limit));
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
