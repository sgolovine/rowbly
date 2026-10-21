import { Box, type DOMElement, Text } from 'ink';
import { type ReactNode, useRef } from 'react';
import { useMouse } from '../hooks';
import { theme } from '../theme';

/** One row of a `SelectList`: the `›` marker on the highlighted row, and a click target while `onClick` is set. */
export function SelectListRow({
  highlighted,
  active,
  onClick,
  children,
}: {
  highlighted: boolean;
  active: boolean;
  onClick?(): void;
  children: ReactNode;
}) {
  const ref = useRef<DOMElement>(null);
  useMouse(ref, { onClick }, active && onClick !== undefined);
  return (
    <Box ref={ref} backgroundColor={highlighted && active ? theme.selection : undefined}>
      <Text color={theme.ink} bold={highlighted}>
        <Text color={active ? theme.accent : theme.inkFaint}>{highlighted ? '▌ ' : '  '}</Text>
        {children}
      </Text>
    </Box>
  );
}
