import { Box, type DOMElement, Text } from 'ink';
import { useRef } from 'react';
import { useMouse } from '../../hooks';
import { theme } from '../../theme';

/** One settings section in the sidebar. The selected one is filled while the sidebar has focus. */
export function SectionNavItem({
  label,
  selected,
  focused,
  clickable,
  onClick,
}: {
  label: string;
  selected: boolean;
  focused: boolean;
  clickable: boolean;
  onClick(): void;
}) {
  const ref = useRef<DOMElement>(null);
  useMouse(ref, { onClick }, clickable);
  const filled = selected && focused;
  return (
    <Box ref={ref} width="100%" paddingRight={1} backgroundColor={filled ? theme.accent : undefined}>
      <Text wrap="truncate-end" color={filled ? theme.ink : selected ? theme.accent : undefined} bold={selected}>
        {selected ? '▌ ' : '  '}
        {label}
      </Text>
    </Box>
  );
}
