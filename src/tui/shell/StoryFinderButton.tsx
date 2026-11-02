import { Box, type DOMElement, Text } from 'ink';
import { useRef } from 'react';
import { useMouse } from '../hooks';
import { theme } from '../theme';

/** An input-like entry point in the header; the actual input lives in the finder. */
export function StoryFinderButton({
  compact,
  clickable,
  onClick,
}: {
  compact: boolean;
  clickable: boolean;
  onClick(): void;
}) {
  const ref = useRef<DOMElement>(null);
  useMouse(ref, { onClick }, clickable);
  return (
    <Box ref={ref} backgroundColor={theme.field} paddingX={1} flexShrink={0}>
      <Text color={theme.inkMuted}>{compact ? '🔎' : '🔎 Find Stories  '}</Text>
      {!compact && (
        <Text color={theme.inkMuted} backgroundColor={theme.keycap}>
          {' '}
          ctrl+p{' '}
        </Text>
      )}
    </Box>
  );
}
