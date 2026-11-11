import { Box, Text } from "ink";
import type { StoryActivity } from "../../../../services/factoryActivity/factoryActivity.js";
import type { Story } from "../../../../services/story/story.js";
import { type RowDragProps, SelectionRow, StageBadge, type StageCategory } from "../../../components/index.js";
import { theme } from "../../../theme.js";

/** The most columns that the label of an agent takes, so the title keeps its room. */
const AGENT_LABEL_MAX = 12;

/** The label of an activity on one line, cut to `AGENT_LABEL_MAX` characters. */
function activityLabel(activity: StoryActivity): string {
  if (activity.kind !== "active") return activity.kind;
  const chars = [...activity.label.replace(/\s+/g, " ")];
  return chars.length <= AGENT_LABEL_MAX ? chars.join("") : `${chars.slice(0, AGENT_LABEL_MAX - 1).join("")}…`;
}

/**
 * One Story in the list: its key and title on the left, its Stage on the right. A Story with factory `activity`
 * shows `▶` and the agent (or `conflict` or `unknown`) to the left of its Stage. `indented` moves the key and title two columns to the
 * right, below the heading of a Stage section. The `RowDragProps` let the mouse drag the row and drop on it.
 */
export function StoryRow({
  story,
  activity,
  stage,
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
        <Box flexShrink={0} paddingLeft={2}>
          <StageBadge stage={stage} />
        </Box>
      </Box>
    </SelectionRow>
  );
}
