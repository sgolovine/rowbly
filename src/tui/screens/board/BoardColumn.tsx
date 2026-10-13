import { Box, Text } from 'ink';
import type { Stage, Story } from '../../../schemas';
import { StageBadge } from '../../components';
import { taskSummary, truncate } from './layout';

export interface BoardColumnProps {
  stage: Stage;
  /** Every Story in the Stage, in Rank order. */
  cards: readonly Story[];
  /** All Stages of the Board, to judge Task Stages. */
  stages: readonly Stage[];
  width: number;
  /** Index of the first card shown and how many are shown. */
  first: number;
  size: number;
  /** The highlighted card (the column is current even when empty), or `null` when the cursor is in another column. */
  selected: number | null;
  active: boolean;
}

/** One Stage: header with name, Stage Category colour and count, then its cards, scrolled to `first`. */
export function BoardColumn({ stage, cards, stages, width, first, size, selected, active }: BoardColumnProps) {
  const shown = cards.slice(first, first + size);
  const below = cards.length - first - shown.length;
  const inner = width - 1;
  return (
    <Box flexDirection="column" width={width} paddingRight={1} flexShrink={0}>
      <Text wrap="truncate-end">
        <StageBadge stage={stage} /> <Text dimColor>({cards.length})</Text>
      </Text>
      {selected === null ? (
        <Text dimColor>{'─'.repeat(inner)}</Text>
      ) : (
        <Text color={active ? 'cyan' : undefined}>{'━'.repeat(inner)}</Text>
      )}
      <Text dimColor>{first > 0 ? `↑ ${first} more` : ' '}</Text>
      {shown.map((story, i) => (
        <Card
          key={story.key}
          story={story}
          stages={stages}
          width={inner}
          selected={selected === first + i}
          active={active}
        />
      ))}
      {cards.length === 0 && <Text dimColor>(empty)</Text>}
      {below > 0 && <Text dimColor>↓ {below} more</Text>}
    </Box>
  );
}

/** Three lines: key and Priority, name, Assignees and Task summary. Never wraps. */
function Card({
  story,
  stages,
  width,
  selected,
  active,
}: {
  story: Story;
  stages: readonly Stage[];
  width: number;
  selected: boolean;
  active: boolean;
}) {
  const marker = <Text color={active ? 'cyan' : undefined}>{selected ? '▌ ' : '  '}</Text>;
  const room = width - 2;
  const meta = [story.assignees.map((h) => `@${h}`).join(' '), taskSummary(story, stages)].filter(Boolean).join(' · ');
  const priority = story.priority ? ` ${story.priority}` : '';
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        {marker}
        <Text bold color="cyan">
          {truncate(story.key, room)}
        </Text>
        <Text color="magenta">{truncate(priority, room - story.key.length)}</Text>
      </Text>
      <Text>
        {marker}
        <Text bold={selected}>{truncate(story.name, room)}</Text>
      </Text>
      <Text>
        {marker}
        <Text dimColor>{truncate(meta, room) || ' '}</Text>
      </Text>
    </Box>
  );
}
