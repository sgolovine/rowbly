import { Box, Text } from "ink";
import { StageBadge } from "../../../components/index.js";
import { theme } from "../../../theme.js";
import type { DependencyItem, DependencyLists } from "../story-dependency-view.js";

/** The width of the labels `Depends on` and `Blocks`, with two columns after them. */
const LABEL_WIDTH = 12;

/** One upstream or downstream Story: its ID, its title and its Stage. */
function DependencyRow({ item }: { item: DependencyItem }) {
  return (
    <Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="truncate-end" color={theme.ink}>
          <Text color={theme.accent}>{item.id}</Text> {item.title}
        </Text>
      </Box>
      {item.stage && (
        <Box flexShrink={0} paddingLeft={2}>
          <StageBadge stage={item.stage} />
        </Box>
      )}
    </Box>
  );
}

/** A label, then one row for each Story of the list, or `none`. */
function DependencyList({ label, items }: { label: string; items: readonly DependencyItem[] }) {
  return (
    <Box>
      <Box width={LABEL_WIDTH} flexShrink={0}>
        <Text color={theme.inkMuted}>{label}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {items.length === 0 && <Text color={theme.inkFaint}>none</Text>}
        {items.map((item) => (
          <DependencyRow key={item.id} item={item} />
        ))}
      </Box>
    </Box>
  );
}

/**
 * The saved dependencies of a Story in the General tab: the upstream Stories (`Depends on`) and the downstream
 * Stories (`Blocks`). The list is read-only. The `Depends on` field of the form changes the upstream Stories.
 */
export function StoryDependencyLists({ lists }: { lists: DependencyLists }) {
  return (
    <Box flexDirection="column" marginTop={1} flexShrink={0}>
      <DependencyList label="Depends on" items={lists.dependsOn} />
      <DependencyList label="Blocks" items={lists.blocks} />
    </Box>
  );
}
