import { Box, type DOMElement, Text } from 'ink';
import { useRef } from 'react';
import { useIsActive, useMouse } from '../hooks';
import { theme } from '../theme';

/** A clickable `✕`, set into a border to close what it frames. */
export function CloseButton({ onClick }: { onClick(): void }) {
  const ref = useRef<DOMElement>(null);
  useMouse(ref, { onClick }, useIsActive());
  return (
    <Box ref={ref} flexShrink={0}>
      <Text color={theme.inkFaint}>{' ✕ '}</Text>
    </Box>
  );
}
