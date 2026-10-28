import { Box, type DOMElement, Text } from 'ink';
import { useRef } from 'react';
import { useScrollFocus } from '../../components';
import { useMouse } from '../../hooks';
import { theme } from '../../theme';

/** One settings section in the sidebar. The selected one keeps its bar and fill, in focus or not. */
export function SectionNavItem({
  label,
  selected,
  clickable,
  onClick,
}: {
  label: string;
  selected: boolean;
  clickable: boolean;
  onClick(): void;
}) {
  const ref = useRef<DOMElement>(null);
  useScrollFocus(ref, selected);
  useMouse(ref, { onClick }, clickable);
  return (
    <Box
      ref={ref}
      flexShrink={0}
      width="100%"
      paddingRight={1}
      backgroundColor={selected ? theme.selection : undefined}
    >
      <Box width={2} flexShrink={0}>
        <Text color={theme.accent}>{selected ? '▌ ' : '  '}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text color={theme.ink} bold={selected}>
          {label}
        </Text>
      </Box>
    </Box>
  );
}
