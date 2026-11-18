import type { Dispatch, RefObject, SetStateAction } from "react";
import type { RowDragProps } from "../../../components/index.js";
import type { ClickEvent } from "../../../hooks/index.js";
import type { StoryListRow } from "../story-list-rows.js";

/** What a drag of a Story carries: its id, and the list that it comes from. */
interface DraggedStory {
  readonly list: object;
  readonly id: string;
}

/** The environment of the clicks and the drags of the Story list. */
export interface StoryListEnv {
  readonly rows: readonly StoryListRow[];
  /** Tells the drags of this list from the drags of other components. */
  readonly self: object;
  readonly cursor: number;
  readonly setSlot: Dispatch<SetStateAction<number | null>>;
  readonly onCursor: (index: number) => void;
  readonly onActivate?: (index: number) => void;
  /** A `shift+click` on the Story row at `index`. */
  readonly onRange?: (index: number) => void;
  /** A click without `shift` clears the multi-selection before it does its action. */
  readonly onClear?: () => void;
  readonly onMove?: (id: string, gap: number) => void;
  /** A right click on the Story row at `index`, at the cell `x`, `y` of the screen. */
  readonly onMenu?: (index: number, x: number, y: number) => void;
}

/** True when `value` is a Story that a drag of this list carries. */
function isDragged(env: StoryListEnv, value: unknown): value is DraggedStory {
  return (value as DraggedStory | null)?.list === env.self;
}

/** The gap for a drag of `value` over the row at `index`, or `null` where the Story would not move. */
function gapAt(env: StoryListEnv, value: unknown, index: number): number | null {
  if (!isDragged(env, value)) {
    return null;
  }

  const from = env.rows.findIndex((row) => row.id === value.id);
  const gap = env.rows[index]?.kind === "stage" || index > from ? index + 1 : index;

  return from >= 0 && (gap === from || gap === from + 1) ? null : gap;
}

/** Ends the drag, and moves the dragged Story to `gap`. */
export function dropStory(env: StoryListEnv, value: unknown, gap: number | null): void {
  env.setSlot(null);

  if (isDragged(env, value) && gap !== null) {
    env.onMove?.(value.id, gap);
  }
}

/**
 * A `shift+click` on a Story row selects the range to it. A different click clears the multi-selection. Then a click
 * on the selected row activates it, and a click on another row selects it.
 */
export function clickRow(env: StoryListEnv, index: number, event: ClickEvent): void {
  if (event.shift && env.onRange && env.rows[index]?.kind === "story") {
    env.onRange(index);

    return;
  }

  env.onClear?.();

  if (env.onActivate && index === env.cursor) {
    env.onActivate(index);

    return;
  }

  env.onCursor(index);
}

/**
 * The drag props of the row at `index`: a Story row can be dragged, and each row takes a drop. The handlers read the
 * latest environment of the list from `list`, so that a memoised row that does not render again still uses it.
 */
export function rowDragProps(list: RefObject<StoryListEnv>, row: StoryListRow, index: number): RowDragProps {
  return {
    drag: row.kind === "story" ? ({ list: list.current.self, id: row.id } satisfies DraggedStory) : undefined,
    onDrop: (value) => dropStory(list.current, value, gapAt(list.current, value, index)),
    onDragOver: (value) => list.current.setSlot(gapAt(list.current, value, index)),
    onDragLeave: () => list.current.setSlot(null),
  };
}

/** Moves the cursor by the lines of a turn of the mouse wheel, inside the list. */
export function wheelCursor(env: StoryListEnv, direction: number, lines: number): void {
  env.onCursor(Math.max(0, Math.min(env.rows.length - 1, env.cursor + direction * lines)));
}
