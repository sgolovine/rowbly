import { Box, type DOMElement, Text } from 'ink';
import { useRef } from 'react';
import { useMouse } from '../hooks';

export function SidebarItem({
  index,
  name,
  selected,
  clickable,
  onClick,
}: {
  index: number;
  name: string;
  selected: boolean;
  clickable: boolean;
  onClick(): void;
}) {
  const ref = useRef<DOMElement>(null);
  useMouse(ref, { onClick }, clickable);
  return (
    <Box ref={ref}>
      <Text wrap="truncate-end" color={selected ? 'cyan' : undefined} bold={selected}>
        {selected ? '▌ ' : '  '}
        <Text dimColor={!selected}>{index < 9 ? `${index + 1} ` : '  '}</Text>
        {name}
      </Text>
    </Box>
  );
}
