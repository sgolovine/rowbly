import { Box, type DOMElement, Text } from 'ink';
import { useRef } from 'react';
import { useIsActive, useMouse } from '../hooks';
import { theme } from '../theme';

/** The button below a `TextArea` that opens its text in a `FullScreenEditor`; `ctrl+f` does the same. */
export function FullScreenButton({
  focused,
  clickable,
  onClick,
}: {
  focused: boolean;
  clickable: boolean;
  onClick(): void;
}) {
  const ref = useRef<DOMElement>(null);
  useMouse(ref, { onClick }, useIsActive() && clickable);
  return (
    <Box ref={ref} flexShrink={0} gap={1} alignSelf="flex-start">
      <Text color={theme.accent} bold={focused}>
        [Full screen]
      </Text>
      {focused && <Text color={theme.inkFaint}>ctrl+f</Text>}
    </Box>
  );
}
