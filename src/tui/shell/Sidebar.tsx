import { Box, Text } from 'ink';
import type { BoardConfig } from '../../schemas';
import { Button, Panel } from '../components';
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
    <Panel title="Boards" width={SIDEBAR_WIDTH} height={height}>
      <Box flexDirection="column" flexShrink={1} overflow="hidden">
        {boards.length === 0 && (
          <Box paddingX={1}>
            <Text dimColor>No Boards yet.</Text>
          </Box>
        )}
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
      <Button label="+ New Board" keyName="N" onClick={onNewBoard} clickable={clickable} />
    </Panel>
  );
}
