import { Box, type DOMElement, Text } from 'ink';
import { useRef } from 'react';
import { useMouse } from '../hooks';
import { theme } from '../theme';

/** One entry, as a row as wide as the sidebar; the current one is filled. A Board shows its `1`–`9` key. */
export function SidebarItem({
  index,
  name,
  selected,
  clickable,
  onClick,
}: {
  index?: number;
  name: string;
  selected: boolean;
  clickable: boolean;
  onClick(): void;
}) {
  const ref = useRef<DOMElement>(null);
  useMouse(ref, { onClick }, clickable);
  return (
    <Box ref={ref} width="100%" paddingRight={1} backgroundColor={selected ? theme.accent : undefined}>
      <Text wrap="truncate-end" color={selected ? theme.ink : undefined} bold={selected}>
        {selected ? '▌ ' : '  '}
        <Text color={theme.inkMuted}>{index === undefined ? '' : index < 9 ? `${index + 1} ` : '  '}</Text>
        {name}
      </Text>
    </Box>
  );
}
