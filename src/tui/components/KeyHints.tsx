import { Box, Text } from 'ink';
import type { KeyHint } from '../keymap';
import { theme } from '../theme';

export function KeyHints({ hints }: { hints: readonly KeyHint[] }) {
  return (
    <Box columnGap={2} flexShrink={1} overflow="hidden">
      {hints.map((hint) => (
        <Text key={`${hint.key}:${hint.description}`} wrap="truncate-end">
          <Text bold color={theme.ink}>
            {hint.key}
          </Text>
          <Text color={theme.inkFaint}> {hint.description}</Text>
        </Text>
      ))}
    </Box>
  );
}
