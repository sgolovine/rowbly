import { Box, type DOMElement, Text } from 'ink';
import { useRef } from 'react';
import { type ContextMenuItem, useMouse } from '../hooks';
import { theme } from '../theme';

/** One item of a `ContextMenu`: the `▌` marker and `selection` fill when highlighted, dimmed when disabled. */
export function ContextMenuRow({
  item,
  width,
  highlighted,
  onHover,
  onClick,
}: {
  item: ContextMenuItem;
  /** Columns inside the menu's frame. */
  width: number;
  highlighted: boolean;
  onHover(): void;
  onClick(): void;
}) {
  const ref = useRef<DOMElement>(null);
  useMouse(ref, { onClick, onEnter: onHover, onContextMenu: () => {}, layer: 1 });
  const label = item.disabled ? theme.inkFaint : theme.ink;
  const gap = Math.max(1, width - 3 - item.label.length - (item.key?.length ?? 0));
  return (
    <Box ref={ref} width={width} backgroundColor={highlighted ? theme.selection : undefined}>
      <Text color={label} bold={highlighted}>
        <Text color={theme.accent}>{highlighted ? '▌ ' : '  '}</Text>
        {item.label}
        {' '.repeat(gap)}
        <Text color={theme.inkMuted} bold={false}>
          {item.key ?? ''}
        </Text>{' '}
      </Text>
    </Box>
  );
}
