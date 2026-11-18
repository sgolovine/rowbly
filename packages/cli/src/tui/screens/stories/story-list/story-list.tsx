import { Box, type DOMElement, Text } from "ink";
import { useRef, useState } from "react";
import type { TagConfig } from "../../../../services/config/config.js";
import type { StoryActivity } from "../../../../services/factory-activity/factory-activity.js";
import { type HostFacts, hostLost, liveHosts } from "../../../../services/thread-connection/thread-connection.js";
import { useMouse, useSharedFactoryStatus, WHEEL_LINES } from "../../../hooks/index.js";
import { theme } from "../../../theme.js";
import { DropSlotRow } from "../drop-slot-row/index.js";
import { StoryListItem } from "../story-list-item/index.js";
import type { StoryListRow } from "../story-list-rows.js";
import { clickRow, dropStory, rowDragProps, type StoryListEnv, wheelCursor } from "./story-list-drag.js";
import { listWindow, visibleItems } from "./story-list-window.js";

/** True when the active agent of `activity` runs on a worker host with a lost connection. */
function activityLost(activity: StoryActivity | undefined, hosts: readonly HostFacts[] | undefined): boolean {
  return activity?.kind === "active" && hostLost(activity.host, hosts);
}

/** No Story is in the multi-selection. */
const NO_MARKS: ReadonlySet<string> = new Set();

export interface StoryListProps {
  readonly rows: readonly StoryListRow[];
  /** The factory activity by Story ID. */
  readonly activity?: Readonly<Record<string, StoryActivity>>;
  /** The tags of the project. A Story row shows the labels of its tags. */
  readonly tags?: readonly TagConfig[];
  readonly cursor: number;
  readonly clickable: boolean;
  /** Rows available; `undefined` shows every row. */
  readonly height?: number;
  readonly emptyText: string;
  /** The IDs of the Stories of the multi-selection. Each one shows a mark. */
  readonly marked?: ReadonlySet<string>;
  onCursor(index: number): void;
  /** A click on the row at `cursor`: a Story opens, and a heading expands or collapses its section. */
  onActivate?(index: number): void;
  /** A `shift+click` on the Story row at `index`: select the Stories from `cursor` to it. */
  onRange?(index: number): void;
  /** A click without `shift`: clear the multi-selection. */
  onClear?(): void;
  /** The Story `id` was dropped in the gap before the row at `gap` (`rows.length` is the end of the list). */
  onMove?(id: string, gap: number): void;
  /** A right click on the Story row at `index`, at the cell `x`, `y` of the screen. */
  onMenu?(index: number, x: number, y: number): void;
}

/**
 * The rows of the Story list, from `storyListRows`, with the row at `cursor` highlighted. A Stage heading
 * starts a section, and the Stories below a heading are indented. When there are more rows than `height`,
 * the list shows the rows around the cursor. A `↑ n more` line shows only when rows are above them, and a
 * `↓ n more` line shows only when rows are below them, so that no blank line shows. The mouse wheel
 * calls `onCursor`. A click on the selected row calls `onActivate`. A click on another row selects it
 * through `onCursor`. A `shift+click` on a Story row calls `onRange`, and each other click calls `onClear` first.
 * Each Story in `marked` shows a `●` mark. The `▶` of a Story whose worker host has a lost connection in the shared
 * factory status shows `connection lost`. With `onMove`, the mouse can drag a Story to another place: an empty `DropSlotRow`
 * shows the gap where it lands, and the release calls `onMove`. Over a Story above the dragged Story, the gap
 * is above that Story; over a Story below it, the gap is below that Story. Over a heading, the gap is below
 * the heading, at the top of its section. A right click on a Story row calls `onMenu`.
 */
export function StoryList({
  rows,
  activity = {},
  tags = [],
  cursor,
  clickable,
  height,
  emptyText,
  marked = NO_MARKS,
  onCursor,
  onActivate,
  onRange,
  onClear,
  onMove,
  onMenu,
}: StoryListProps) {
  const ref = useRef<DOMElement>(null);
  const self = useRef({}).current;
  // The gap that the dragged Story lands in: the index of the row below it.
  const [slot, setSlot] = useState<number | null>(null);
  const status = useSharedFactoryStatus()?.data;
  const hosts = status ? liveHosts(status) : undefined;

  const view = listWindow(rows.length, height, cursor, slot);
  const sections = rows.some((row) => row.kind === "stage");
  const env: StoryListEnv = { rows, self, cursor, setSlot, onCursor, onActivate, onRange, onClear, onMove };

  useMouse(ref, { onWheel: (direction) => wheelCursor(env, direction, WHEEL_LINES) }, clickable && view.overflow);

  if (rows.length === 0) {
    return <Text color={theme.inkFaint}>{emptyText}</Text>;
  }

  return (
    <Box ref={ref} flexDirection="column">
      {view.above > 0 && <Text color={theme.inkFaint}>{`↑ ${view.above} more`}</Text>}
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
            hostLost={item.row.kind === "story" && activityLost(activity[item.row.story.id], hosts)}
            tags={tags}
            selected={item.index === cursor}
            clickable={clickable}
            indented={sections}
            marked={marked.has(item.row.id)}
            onClick={(event) => clickRow(env, item.index, event)}
            onMenu={onMenu && ((x, y) => onMenu(item.index, x, y))}
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
      {view.below > 0 && <Text color={theme.inkFaint}>{`↓ ${view.below} more`}</Text>}
    </Box>
  );
}
