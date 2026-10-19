import { Box, Text } from 'ink';
import { BoardListRow } from './BoardListRow';
import type { ListRow } from './layout';

export interface BoardListProps {
  rows: readonly ListRow[];
  width: number;
  /** Index of the first line shown and how many are shown. */
  first: number;
  size: number;
  cursor: number;
  active: boolean;
  /** A line clicked, by its index in `rows`. */
  onClick(index: number): void;
}

/** The list view: the Backlog, Board and Done sections, scrolled to `first`. */
export function BoardList({ rows, width, first, size, cursor, active, onClick }: BoardListProps) {
  const shown = rows.slice(first, first + size);
  const below = rows.length - first - shown.length;
  return (
    <Box flexDirection="column" width={width}>
      <Text dimColor>{first > 0 ? `↑ ${first} more` : ' '}</Text>
      {shown.map((row, i) => (
        <BoardListRow
          key={row.kind === 'section' ? `section:${row.category}` : row.story.key}
          row={row}
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
