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
    <Box ref={ref} width="100%" paddingRight={1} backgroundColor={selected ? theme.selection : undefined}>
      <Text color={theme.accent}>{selected ? '▌ ' : '  '}</Text>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="truncate-end" color={theme.ink} bold={selected}>
          {name}
        </Text>
      </Box>
      {index !== undefined && <Text color={theme.inkFaint}>{index < 9 ? index + 1 : ' '}</Text>}
    </Box>
  );
}
