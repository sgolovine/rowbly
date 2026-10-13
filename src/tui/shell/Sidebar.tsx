import { Box, Text } from 'ink';
import type { BoardConfig } from '../../schemas';
import { HeaderButton } from './HeaderButton';
import { SIDEBAR_WIDTH } from './layout';
import { SidebarItem } from './SidebarItem';

export function Sidebar({
  boards,
  current,
  height,
  clickable,
  onSelect,
  onNewBoard,
}: {
  boards: readonly BoardConfig[];
  current: number;
  height?: number;
  clickable: boolean;
  onSelect(boardId: string): void;
  onNewBoard(): void;
}) {
  return (
    <Box
      flexDirection="column"
      width={SIDEBAR_WIDTH}
      height={height}
      flexShrink={0}
      paddingX={1}
      borderStyle="single"
      borderTop={false}
      borderBottom={false}
      borderLeft={false}
      borderDimColor
    >
      <Text dimColor bold>
        BOARDS
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {boards.length === 0 && <Text dimColor>No Boards yet.</Text>}
        {boards.map((board, i) => (
          <SidebarItem
            key={board.id}
            index={i}
            name={board.name}
            selected={i === current}
            clickable={clickable}
            onClick={() => onSelect(board.id)}
          />
        ))}
      </Box>
      <Box flexGrow={1} minHeight={1} />
      <Box gap={1}>
        <HeaderButton label="+ New Board" onClick={onNewBoard} clickable={clickable} />
        <Text dimColor>N</Text>
      </Box>
    </Box>
  );
}
