import { Box, Text } from "ink";
import type { StoryActivity } from "../../../../services/factory-activity/factory-activity.js";
import type { Story } from "../../../../services/story/story.js";
import { LOCAL_HOST } from "../../../../services/thread/thread.js";
import { type RowDragProps, SelectionRow, StageBadge, type StageCategory } from "../../../components/index.js";
import type { ClickEvent } from "../../../hooks/index.js";
import { theme } from "../../../theme.js";
import { waitingText } from "../story-dependency-view.js";

/** The most columns that the label of an agent takes, so the title keeps its room. */
const AGENT_LABEL_MAX = 12;

/** The label of an activity on one line, cut to `AGENT_LABEL_MAX` characters. */
function activityLabel(activity: StoryActivity): string {
  if (activity.kind !== "active") {
    return activity.kind;
  }

  const chars = [...activity.label.replace(/\s+/g, " ")];

  const label = chars.length <= AGENT_LABEL_MAX ? chars.join("") : `${chars.slice(0, AGENT_LABEL_MAX - 1).join("")}…`;

  return activity.host === LOCAL_HOST ? label : `${label} @${activity.host}`;
}

/**
 * The text before the key of the Story: the `●` mark of a Story in the multi-selection, or the indent. In a list with
 * Stage sections, the mark takes the place of the indent, so the key does not move.
 */
function markText(marked: boolean, indented: boolean): string {
  if (marked) {
    return "● ";
  }

  return indented ? "  " : "";
}

/** A blocked Story in a work Stage with no factory activity shows the Stories that it waits for. */
function showsWaiting(
  waitingFor: readonly string[],
  activity: StoryActivity | undefined,
  category: StageCategory,
): boolean {
  return waitingFor.length > 0 && activity === undefined && category === "board";
}

/**
 * One Story in the list: its key and title on the left, its Stage on the right. The labels of its tags follow the
 * title in `inkMuted`, and they truncate before the title does. A blocked Story (with upstream
 * Stories in `waitingFor`) shows `⊘` before the other slots. A Story with factory `activity`
 * shows `▶` and the agent (or `conflict` or `unknown`) to the left of its Stage. An agent on a worker host shows
 * `@<host>` after the agent, and `connection lost` in `danger` when `hostLost` is true. A blocked Story in a work Stage
 * without activity shows `waiting for` and the IDs there. `indented` moves the key and title two columns to the
 * right, below the heading of a Stage section. A right click calls `onMenu`. A `marked` Story (in the multi-selection) shows `●` before its key. The `RowDragProps` let the mouse drag the row and drop on it.
 */
export function StoryRow({
  story,
  activity,
  hostLost = false,
  stage,
  waitingFor = [],
  tagLabels = [],
  selected,
  clickable,
  indented = false,
  marked = false,
  onClick,
  onMenu,
  ...dragProps
}: {
  story: Story;
  /** The activity that the factory state records for the Story. */
  activity?: StoryActivity;
  /** The worker host of the active agent has a lost connection. */
  hostLost?: boolean;
  stage: { name: string; category: StageCategory };
  /** The IDs of the upstream Stories that are not complete. */
  waitingFor?: readonly string[];
  /** The labels of the tags of the Story, in the order of the Story. */
  tagLabels?: readonly string[];
  selected: boolean;
  clickable: boolean;
  indented?: boolean;
  /** The Story is in the multi-selection of the Story list. */
  marked?: boolean;
  onClick(event: ClickEvent): void;
  /** A right click on the row, at the cell `x`, `y` of the screen. */
  onMenu?(x: number, y: number): void;
} & RowDragProps) {
  return (
    <SelectionRow selected={selected} active={clickable} onClick={onClick} onMenu={onMenu} {...dragProps}>
      <Box paddingRight={1}>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end" color={theme.ink} bold={selected}>
            <Text color={theme.accent}>{markText(marked, indented)}</Text>
            <Text color={theme.accent}>{story.id}</Text> {story.title}
          </Text>
        </Box>
        {tagLabels.length > 0 && (
          // The large shrink factor makes the tags give up their room before the title does.
          <Box flexShrink={100} paddingLeft={2}>
            <Text color={theme.inkMuted} wrap="truncate-end">
              {tagLabels.join(" · ")}
            </Text>
          </Box>
        )}
        {waitingFor.length > 0 && (
          <Box flexShrink={0} paddingLeft={2}>
            <Text color={theme.inkMuted}>⊘</Text>
          </Box>
        )}
        {!!story.attachmentCount && (
          <Box flexShrink={0} paddingLeft={2}>
            <Text color={theme.inkMuted}>▧ {story.attachmentCount}</Text>
          </Box>
        )}
        {activity && (
          <Box flexShrink={0} paddingLeft={2}>
            <Text color={theme.inkMuted}>
              ▶ {activityLabel(activity)}
              {hostLost && <Text color={theme.danger}> connection lost</Text>}
            </Text>
          </Box>
        )}
        {showsWaiting(waitingFor, activity, stage.category) && (
          <Box flexShrink={1} paddingLeft={2}>
            <Text color={theme.inkMuted} wrap="truncate-end">
              {waitingText(waitingFor)}
            </Text>
          </Box>
        )}
        <Box flexShrink={0} paddingLeft={2}>
          <StageBadge stage={stage} />
        </Box>
      </Box>
    </SelectionRow>
  );
}
