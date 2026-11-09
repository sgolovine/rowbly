import { Box, Text } from "ink";
import type { Story } from "../../../../services/story/story.js";
import { type RowDragProps, SelectionRow, StageBadge, type StageCategory } from "../../../components/index.js";
import { theme } from "../../../theme.js";

/**
 * One Story in the list: its key and title on the left, its Stage on the right. `indented` moves the key
 * and title two columns to the right, below the heading of a Stage section. The `RowDragProps` let the mouse
 * drag the row and drop on it.
 */
export function StoryRow({
  story,
  stage,
  selected,
  clickable,
  indented = false,
  onClick,
  ...dragProps
}: {
  story: Story;
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
        <Box flexShrink={0} paddingLeft={2}>
          <StageBadge stage={stage} />
        </Box>
      </Box>
    </SelectionRow>
  );
}
