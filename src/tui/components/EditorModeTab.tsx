import { Box, type DOMElement, Text } from 'ink';
import { useRef } from 'react';
import { useMouse } from '../hooks';
import { theme } from '../theme';

/** One of the `View` and `Edit` tabs above a `FullScreenEditor`'s text; a click selects it. */
export function EditorModeTab({
  label,
  selected,
  active,
  onClick,
}: {
  label: string;
  selected: boolean;
  active: boolean;
  onClick(): void;
}) {
  const ref = useRef<DOMElement>(null);
  useMouse(ref, { onClick }, active);
  return (
    <Box ref={ref} flexShrink={0}>
      <Text bold={selected} backgroundColor={selected ? theme.selection : undefined}>
        {` ${label} `}
      </Text>
    </Box>
  );
}
