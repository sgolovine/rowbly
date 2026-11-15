import { Box, Text } from "ink";
import type { StoryActivity } from "../../../../services/factory-activity/factory-activity.js";
import type { Story } from "../../../../services/story/story.js";
import { type RowDragProps, SelectionRow, StageBadge, type StageCategory } from "../../../components/index.js";
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

  return chars.length <= AGENT_LABEL_MAX ? chars.join("") : `${chars.slice(0, AGENT_LABEL_MAX - 1).join("")}…`;
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
 * One Story in the list: its key and title on the left, its Stage on the right. A blocked Story (with upstream
 * Stories in `waitingFor`) shows `⊘` before the other slots. A Story with factory `activity`
 * shows `▶` and the agent (or `conflict` or `unknown`) to the left of its Stage. A blocked Story in a work Stage
 * without activity shows `waiting for` and the IDs there. `indented` moves the key and title two columns to the
 * right, below the heading of a Stage section. The `RowDragProps` let the mouse drag the row and drop on it.
 */
export function StoryRow({
  story,
  activity,
  stage,
  waitingFor = [],
  selected,
  clickable,
  indented = false,
  onClick,
  ...dragProps
}: {
  story: Story;
  /** The activity that the factory state records for the Story. */
  activity?: StoryActivity;
  stage: { name: string; category: StageCategory };
  /** The IDs of the upstream Stories that are not complete. */
  waitingFor?: readonly string[];
  selected: boolean;
  clickable: boolean;
  indented?: boolean;
  onClick(): void;
} & RowDragProps) {
  return (
    <SelectionRow selected={selected} active={clickable} onClick={onClick} {...dragProps}>
      <Box paddingLeft={indented ? 2 : 0} paddingRight={1}>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end" color={theme.ink} bold={selected}>
            <Text color={theme.accent}>{story.id}</Text> {story.title}
          </Text>
        </Box>
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
            <Text color={theme.inkMuted}>▶ {activityLabel(activity)}</Text>
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
