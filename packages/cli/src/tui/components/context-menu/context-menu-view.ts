import type { KeyHint } from "../../keymap.js";

/** One item of a `ContextMenu`. */
export interface ContextMenuItem {
  readonly label: string;
  /** The key that does the same operation on the screen, or none. */
  readonly keyName?: string;
  /** The item does not apply: it shows in `ink-faint`, the cursor moves past it and a click does nothing. */
  readonly disabled?: boolean;
}

/** The size of a menu in cells, with its frame. */
export interface MenuSize {
  readonly width: number;
  readonly height: number;
}

/** The place of the top-left corner of a menu on the screen. */
export interface MenuPlace {
  readonly left: number;
  readonly top: number;
}

/** The keys of an open `ContextMenu`, for the footer. */
export const CONTEXT_MENU_HINTS: readonly KeyHint[] = [
  { key: "↑/↓", description: "select" },
  { key: "enter", description: "run" },
  { key: "esc", description: "close" },
];

/** The columns of the frame (2), the `▌` bar (2), the gap between the label and the key (2) and the right padding (1). */
const CHROME_COLUMNS = 7;

/** The rows of the frame. */
const CHROME_ROWS = 2;

function longest(texts: readonly string[]): number {
  return Math.max(0, ...texts.map((text) => [...text].length));
}

/** The size of a menu with `items`: one row for each item, and the widest label and key. */
export function menuSize(items: readonly ContextMenuItem[]): MenuSize {
  const labels = longest(items.map((item) => item.label));
  const keys = longest(items.map((item) => item.keyName ?? ""));

  return { width: CHROME_COLUMNS + labels + keys, height: CHROME_ROWS + items.length };
}

/** Moves `at` in from the edge so that `size` cells fit in `room`. An unknown room keeps `at`. */
function clamp(at: number, size: number, room: number | undefined): number {
  return room === undefined ? Math.max(0, at) : Math.max(0, Math.min(at, room - size));
}

/**
 * The top-left corner of a menu of `size` that opens at the cell `x`, `y`. The menu moves in from the right and the
 * bottom edges of the `screen`, so that all of it shows.
 */
export function menuPlace(
  x: number,
  y: number,
  size: MenuSize,
  screen: { readonly width: number; readonly height?: number },
): MenuPlace {
  return { left: clamp(x, size.width, screen.width), top: clamp(y, size.height, screen.height) };
}

/** The first item that applies, or `-1` when no item applies. */
export function firstEnabled(items: readonly ContextMenuItem[]): number {
  return items.findIndex((item) => !item.disabled);
}

/**
 * The cursor after one step of `delta` from `cursor`: the next item that applies in that direction. The cursor stays
 * at the first or the last item that applies.
 */
export function stepCursor(items: readonly ContextMenuItem[], cursor: number, delta: -1 | 1): number {
  const ahead = items
    .map((item, index) => ({ item, index }))
    .filter(({ item, index }) => !item.disabled && (delta > 0 ? index > cursor : index < cursor));
  const next = delta > 0 ? ahead.at(0) : ahead.at(-1);

  return next ? next.index : cursor;
}
