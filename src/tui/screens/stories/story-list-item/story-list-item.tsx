import type { StoryActivity } from "../../../../services/factory-activity/factory-activity.js";
import type { RowDragProps } from "../../../components/index.js";
import type { ClickEvent } from "../../../hooks/index.js";
import { StageHeadingRow } from "../stage-heading-row/index.js";
import type { StoryListRow } from "../story-list-rows.js";
import { StoryRow } from "../story-row/index.js";

export interface StoryListItemProps {
  readonly row: StoryListRow;
  /** The factory activity of the Story of the row. */
  readonly activity: StoryActivity | undefined;
  readonly selected: boolean;
  readonly clickable: boolean;
  /** The list has Stage sections, so a Story row moves to the right of its heading. */
  readonly indented: boolean;
  /** The Story of the row is in the multi-selection. */
  readonly marked: boolean;
  readonly onClick: (event: ClickEvent) => void;
  /** The props that let the mouse drag the row and drop a Story on it. */
  readonly dragProps: RowDragProps;
}

/** One row of the Story list: the heading of a Stage section, or a Story. */
export function StoryListItem({
  row,
  activity,
  selected,
  clickable,
  indented,
  marked,
  onClick,
  dragProps,
}: StoryListItemProps) {
  return row.kind === "stage" ? (
    <StageHeadingRow
      label={row.label}
      count={row.count}
      collapsed={row.collapsed}
      selected={selected}
      clickable={clickable}
      onClick={() => onClick({ shift: false })}
      {...dragProps}
    />
  ) : (
    <StoryRow
      story={row.story}
      activity={activity}
      stage={row.stage}
      waitingFor={row.waitingFor}
      selected={selected}
      clickable={clickable}
      indented={indented}
      marked={marked}
      onClick={onClick}
      {...dragProps}
    />
  );
}
