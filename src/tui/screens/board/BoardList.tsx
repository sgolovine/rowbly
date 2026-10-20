import { Box, Text } from 'ink';
import type { Stage } from '../../../schemas';
import type { StoryBadges } from '../../hooks';
import { BoardListRow } from './BoardListRow';
import type { ListRow } from './layout';
import { useCardBadges } from './useCardBadges';

export interface BoardListProps {
  rows: readonly ListRow[];
  /** All Stages of the Board, for the Plugins' card badges. */
  stages: readonly Stage[];
  /** The Plugins' badges for a Story, loaded with the Stories. */
  storyBadges: StoryBadges;
  width: number;
  /** Index of the first line shown and how many are shown. */
  first: number;
  size: number;
  cursor: number;
  active: boolean;
  /** A line clicked, by its index in `rows`. */
  onClick(index: number): void;
}

/** The list view: the Backlog, Board and Done sections, scrolled to `first`. Story lines show the card's badges. */
export function BoardList({ rows, stages, storyBadges, width, first, size, cursor, active, onClick }: BoardListProps) {
  const shown = rows.slice(first, first + size);
  const below = rows.length - first - shown.length;
  const badgesOf = useCardBadges();
  return (
    <Box flexDirection="column" width={width}>
      <Text dimColor>{first > 0 ? `↑ ${first} more` : ' '}</Text>
      {shown.map((row, i) => (
        <BoardListRow
          key={row.kind === 'section' ? `section:${row.category}` : row.story.key}
          row={row}
          badges={row.kind === 'story' ? [...storyBadges(row.story), ...badgesOf(row.story, stages)] : []}
          width={width}
          selected={first + i === cursor}
          active={active}
          onClick={() => onClick(first + i)}
        />
      ))}
      {below > 0 && <Text dimColor>↓ {below} more</Text>}
    </Box>
  );
}
