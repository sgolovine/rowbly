import { Box, type DOMElement, Text } from 'ink';
import { type ReactNode, useRef } from 'react';
import { useMouse } from '../hooks';
import { theme } from '../theme';
import { useScrollFocus } from './scrollFocus';

/**
 * One row of a `SelectList`: the `›` marker on the highlighted row, and a click target while `onClick` or
 * `onContextMenu` is set.
 */
export function SelectListRow({
  highlighted,
  active,
  onClick,
  onContextMenu,
  children,
}: {
  highlighted: boolean;
  active: boolean;
  onClick?(): void;
  /** A right click on the row, at cell `x`, `y`. */
  onContextMenu?(x: number, y: number): void;
  children: ReactNode;
}) {
  const ref = useRef<DOMElement>(null);
  useScrollFocus(ref, highlighted && active);
  useMouse(ref, { onClick, onContextMenu }, active && (onClick !== undefined || onContextMenu !== undefined));
  return (
    <Box ref={ref} backgroundColor={highlighted ? theme.selection : undefined}>
      <Text color={theme.ink} bold={highlighted}>
        <Text color={theme.accent}>{highlighted ? '▌ ' : '  '}</Text>
        {children}
      </Text>
    </Box>
  );
}
