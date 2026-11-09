import { Box, type DOMElement, Text } from "ink";
import { useRef, useState } from "react";
import type { RowDragProps } from "../../../components/index.js";
import { useMouse, WHEEL_LINES } from "../../../hooks/index.js";
import { theme } from "../../../theme.js";
import { DropSlotRow } from "../DropSlotRow/index.js";
import { StageHeadingRow } from "../StageHeadingRow/index.js";
import { StoryRow } from "../StoryRow/index.js";
import type { StoryListRow } from "../storyListRows.js";

/** What a drag of a Story carries: its id, and the list that it comes from. */
interface DraggedStory {
  list: object;
  id: string;
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
  cursor,
  clickable,
  height,
  emptyText,
  onCursor,
  onActivate,
  onMove,
}: {
  rows: readonly StoryListRow[];
  cursor: number;
  clickable: boolean;
  /** Rows available; `undefined` shows every row. */
  height?: number;
  emptyText: string;
  onCursor(index: number): void;
  /** A click on the row at `cursor`: a Story opens, and a heading expands or collapses its section. */
  onActivate?(index: number): void;
  /** The Story `id` was dropped in the gap before the row at `gap` (`rows.length` is the end of the list). */
  onMove?(id: string, gap: number): void;
}) {
  const ref = useRef<DOMElement>(null);
  // Tells the drags of this list from the drags of other components.
  const self = useRef({}).current;
  // The gap that the dragged Story lands in: the index of the row below it.
  const [slot, setSlot] = useState<number | null>(null);
  const dragged = (value: unknown): value is DraggedStory => (value as DraggedStory | null)?.list === self;
  /** The gap for a drag of `value` over the row at `index`, or `null` where the Story would not move. */
  const gapAt = (value: unknown, index: number): number | null => {
    if (!dragged(value)) return null;
    const from = rows.findIndex((row) => row.id === value.id);
    const gap = rows[index]?.kind === "stage" || index > from ? index + 1 : index;
    return from >= 0 && (gap === from || gap === from + 1) ? null : gap;
  };
  const drop = (value: unknown, gap: number | null) => {
    setSlot(null);
    if (dragged(value) && gap !== null) onMove?.(value.id, gap);
  };
  const overflow = height !== undefined && rows.length > height;
  // One row each for the `↑ n more` and `↓ n more` lines, when the list does not fit.
  const limit = overflow ? Math.max(1, height - 2) : rows.length;
  const start = Math.max(0, Math.min(cursor - Math.floor(limit / 2), rows.length - limit));
  // The gap takes a line, so the last row that fits leaves; the rows above it stay where they are.
  const shown = overflow && slot !== null && slot >= start && slot <= start + limit ? limit - 1 : limit;
  const above = start;
  const below = rows.length - start - shown;
  const sections = rows.some((row) => row.kind === "stage");
  useMouse(
    ref,
    {
      onWheel: (direction) => onCursor(Math.max(0, Math.min(rows.length - 1, cursor + direction * WHEEL_LINES))),
    },
    clickable && overflow,
  );
  if (rows.length === 0) return <Text color={theme.inkFaint}>{emptyText}</Text>;
  return (
    <Box ref={ref} flexDirection="column">
      {overflow && <Text color={theme.inkFaint}>{above > 0 ? `↑ ${above} more` : " "}</Text>}
      {rows.slice(start, start + shown).flatMap((row, i) => {
        const index = start + i;
        const click = () => (onActivate && index === cursor ? onActivate(index) : onCursor(index));
        const dragProps: RowDragProps = onMove
          ? {
              drag: row.kind === "story" ? ({ list: self, id: row.id } satisfies DraggedStory) : undefined,
              onDrop: (value) => drop(value, gapAt(value, index)),
              onDragOver: (value) => setSlot(gapAt(value, index)),
              onDragLeave: () => setSlot(null),
            }
          : {};
        const gap = slot === index && (
          <DropSlotRow
            key="drop-slot"
            clickable={clickable}
            onDragOver={() => setSlot(index)}
            onDragLeave={() => setSlot(null)}
            onDrop={(value) => drop(value, index)}
          />
        );
        const item =
          row.kind === "stage" ? (
            <StageHeadingRow
              key={row.id}
              label={row.label}
              count={row.count}
              collapsed={row.collapsed}
              selected={index === cursor}
              clickable={clickable}
              onClick={click}
              {...dragProps}
            />
          ) : (
            <StoryRow
              key={row.id}
              story={row.story}
              stage={row.stage}
              selected={index === cursor}
              clickable={clickable}
              indented={sections}
              onClick={click}
              {...dragProps}
            />
          );
        // One flat list, so a row keeps its place in the tree, and its mouse target, when the gap appears.
        return gap ? [gap, item] : [item];
      })}
      {slot === rows.length && start + shown === rows.length && (
        <DropSlotRow
          clickable={clickable}
          onDragOver={() => setSlot(rows.length)}
          onDragLeave={() => setSlot(null)}
          onDrop={(value) => drop(value, rows.length)}
        />
      )}
      {overflow && <Text color={theme.inkFaint}>{below > 0 ? `↓ ${below} more` : " "}</Text>}
    </Box>
  );
}
