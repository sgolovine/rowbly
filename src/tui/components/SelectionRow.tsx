import { Box, type DOMElement, Text } from 'ink';
import { type ReactNode, useRef } from 'react';
import { useMouse } from '../hooks';
import { theme } from '../theme';
import { useScrollFocus } from './scrollFocus';

/** Shared selection bar and fill, including focus-following scroll and an optional mouse target. */
export function SelectionRow({
  selected,
  active,
  onClick,
  children,
}: {
  selected: boolean;
  active: boolean;
  onClick?(): void;
  children: ReactNode;
}) {
  const ref = useRef<DOMElement>(null);
  useScrollFocus(ref, selected && active);
  useMouse(ref, { onClick }, active && onClick !== undefined);
  return (
    <Box ref={ref} backgroundColor={selected ? theme.selection : undefined}>
      <Text color={theme.accent}>{selected ? '▌ ' : '  '}</Text>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {children}
      </Box>
    </Box>
  );
}
