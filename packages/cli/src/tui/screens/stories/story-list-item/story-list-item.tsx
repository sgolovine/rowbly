import { memo, type RefObject } from "react";
import type { TagConfig } from "../../../../services/config/config.js";
import type { StoryActivity } from "../../../../services/factory-activity/factory-activity.js";
import { type RowDragProps, SectionHeadingRow } from "../../../components/index.js";
import { clickRow, rowDragProps, type StoryListEnv } from "../story-list/story-list-drag.js";
import type { StoryListRow } from "../story-list-rows.js";
import { StoryRow } from "../story-row/index.js";
import { tagLabels } from "../story-tag-view.js";

/** A row of a list without `onMove` cannot be dragged and takes no drop. */
const NO_DRAG: RowDragProps = {};

export interface StoryListItemProps {
  readonly row: StoryListRow;
  /** The index of the row in the list. */
  readonly index: number;
  /** The factory activity of the Story of the row. */
  readonly activity: StoryActivity | undefined;
  /** The worker host of the active agent of the Story has a lost connection. */
  readonly hostLost?: boolean;
  /** The tags of the project, for the labels of the tags of the Story. */
  readonly tags: readonly TagConfig[];
  readonly selected: boolean;
  readonly clickable: boolean;
  /** The list has Stage sections, so a Story row moves to the right of its heading. */
  readonly indented: boolean;
  /** The Story of the row is in the multi-selection. */
  readonly marked: boolean;
  /** The list has `onMove`, so the mouse can drag the row and drop a Story on it. */
  readonly movable: boolean;
  /**
   * The latest environment of the list. The ref keeps its identity, so a cursor move does not render the rows that
   * did not change, and the handlers of a row still read the latest cursor, rows and callbacks.
   */
  readonly list: RefObject<StoryListEnv>;
}

/** One row of the Story list: the heading of a Stage section, or a Story. It renders again only when its data changes. */
export const StoryListItem = memo(function StoryListItem({
  row,
  index,
  activity,
  hostLost = false,
  tags,
  selected,
  clickable,
  indented,
  marked,
  movable,
  list,
}: StoryListItemProps) {
  const dragProps = movable ? rowDragProps(list, row, index) : NO_DRAG;

  return row.kind === "stage" ? (
    <SectionHeadingRow
      label={row.label}
      count={row.count}
      collapsed={row.collapsed}
      selected={selected}
      clickable={clickable}
      onClick={() => clickRow(list.current, index, { shift: false })}
      emptyText="No Stories"
      {...dragProps}
    />
  ) : (
    <StoryRow
      story={row.story}
      activity={activity}
      hostLost={hostLost}
      stage={row.stage}
      waitingFor={row.waitingFor}
      tagLabels={tagLabels(row.story.tags, tags)}
      selected={selected}
      clickable={clickable}
      indented={indented}
      marked={marked}
      onClick={(event) => clickRow(list.current, index, event)}
      {...dragProps}
    />
  );
});
