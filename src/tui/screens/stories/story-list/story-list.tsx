import { Box, type DOMElement, Text } from "ink";
import { useRef, useState } from "react";
import type { StoryActivity } from "../../../../services/factory-activity/factory-activity.js";
import { useMouse, WHEEL_LINES } from "../../../hooks/index.js";
import { theme } from "../../../theme.js";
import { DropSlotRow } from "../drop-slot-row/index.js";
import { StoryListItem } from "../story-list-item/index.js";
import type { StoryListRow } from "../story-list-rows.js";
import { clickRow, dropStory, rowDragProps, type StoryListEnv, wheelCursor } from "./story-list-drag.js";
import { listWindow, visibleItems } from "./story-list-window.js";

export interface StoryListProps {
  readonly rows: readonly StoryListRow[];
  /** The factory activity by Story ID. */
  readonly activity?: Readonly<Record<string, StoryActivity>>;
  readonly cursor: number;
  readonly clickable: boolean;
  /** Rows available; `undefined` shows every row. */
  readonly height?: number;
  readonly emptyText: string;
  onCursor(index: number): void;
  /** A click on the row at `cursor`: a Story opens, and a heading expands or collapses its section. */
  onActivate?(index: number): void;
  /** The Story `id` was dropped in the gap before the row at `gap` (`rows.length` is the end of the list). */
  onMove?(id: string, gap: number): void;
}

/**
 * The rows of the Story list, from `storyListRows`, with the row at `cursor` highlighted. A Stage heading
 * starts a section, and the Stories below a heading are indented. When there are more rows than `height`,
 * the list shows the rows around the cursor and says how many more are above and below. The mouse wheel
 * calls `onCursor`. A click on the selected row calls `onActivate`. A click on another row selects it
 * through `onCursor`. With `onMove`, the mouse can drag a Story to another place: an empty `DropSlotRow`
 * shows the gap where it lands, and the release calls `onMove`. Over a Story above the dragged Story, the gap
 * is above that Story; over a Story below it, the gap is below that Story. Over a heading, the gap is below
 * the heading, at the top of its section.
 */
export function StoryList({
  rows,
  activity = {},
  cursor,
  clickable,
  height,
  emptyText,
  onCursor,
  onActivate,
  onMove,
}: StoryListProps) {
  const ref = useRef<DOMElement>(null);
  const self = useRef({}).current;
  // The gap that the dragged Story lands in: the index of the row below it.
  const [slot, setSlot] = useState<number | null>(null);

  const view = listWindow(rows.length, height, cursor, slot);
  const sections = rows.some((row) => row.kind === "stage");
  const env: StoryListEnv = { rows, self, cursor, setSlot, onCursor, onActivate, onMove };

  useMouse(ref, { onWheel: (direction) => wheelCursor(env, direction, WHEEL_LINES) }, clickable && view.overflow);

  if (rows.length === 0) {
    return <Text color={theme.inkFaint}>{emptyText}</Text>;
  }

  return (
    <Box ref={ref} flexDirection="column">
      {view.overflow && <Text color={theme.inkFaint}>{view.above > 0 ? `↑ ${view.above} more` : " "}</Text>}
      {visibleItems(rows, view, slot).map((item) =>
        item.kind === "gap" ? (
          <DropSlotRow
            key="drop-slot"
            clickable={clickable}
            onDragOver={() => setSlot(item.index)}
            onDragLeave={() => setSlot(null)}
            onDrop={(value) => dropStory(env, value, item.index)}
          />
        ) : (
          <StoryListItem
            key={item.row.id}
            row={item.row}
            activity={item.row.kind === "story" ? activity[item.row.story.id] : undefined}
            selected={item.index === cursor}
            clickable={clickable}
            indented={sections}
            onClick={() => clickRow(env, item.index)}
            dragProps={rowDragProps(env, item.row, item.index)}
          />
        ),
      )}
      {slot === rows.length && view.start + view.shown === rows.length && (
        <DropSlotRow
          clickable={clickable}
          onDragOver={() => setSlot(rows.length)}
          onDragLeave={() => setSlot(null)}
          onDrop={(value) => dropStory(env, value, rows.length)}
        />
      )}
      {view.overflow && <Text color={theme.inkFaint}>{view.below > 0 ? `↓ ${view.below} more` : " "}</Text>}
    </Box>
  );
}
