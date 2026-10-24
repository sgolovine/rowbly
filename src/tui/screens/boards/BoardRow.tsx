import { Box, type DOMElement, Text } from 'ink';
import { useRef } from 'react';
import type { BoardConfig } from '../../../schemas';
import { useMouse } from '../../hooks';
import { theme } from '../../theme';

/** One Board in the Boards list: its name, id and key prefix, and whether it is the Board in context. */
export function BoardRow({
  board,
  inContext,
  selected,
  active,
  onClick,
  onContextMenu,
}: {
  board: BoardConfig;
  inContext: boolean;
  selected: boolean;
  active: boolean;
  onClick(): void;
  /** A right click on the row, at cell `x`, `y`. */
  onContextMenu(x: number, y: number): void;
}) {
  const ref = useRef<DOMElement>(null);
  useMouse(ref, { onClick, onContextMenu }, active);
  return (
    <Box ref={ref} backgroundColor={selected ? theme.selection : undefined}>
      <Text color={theme.accent}>{selected ? '▌ ' : '  '}</Text>
      <Text bold={selected}>
        {board.name} <Text color={theme.inkFaint}>{`${board.id} · ${board.keyPrefix}`}</Text>
        {inContext ? <Text color={theme.stageDone}> (current)</Text> : null}
      </Text>
    </Box>
  );
}
