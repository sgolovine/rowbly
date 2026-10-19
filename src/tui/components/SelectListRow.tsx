import { Box, type DOMElement, Text } from 'ink';
import { type ReactNode, useRef } from 'react';
import { useMouse } from '../hooks';

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
    <Box ref={ref}>
      <Text color={highlighted && active ? 'cyan' : undefined}>
        {highlighted ? '› ' : '  '}
        {children}
      </Text>
    </Box>
  );
}
