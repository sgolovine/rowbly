import { Box, Text } from 'ink';
import type { KeyHint } from '../keymap';

export function Footer({ hints, atRoot }: { hints: readonly KeyHint[]; atRoot: boolean }) {
  // Away from the root the screen's keys are on its modal; this keeps to the global ones.
  // Only the primary keys fit here; `?` lists the rest.
  const shown = [
    ...hints.filter((hint) => !hint.secondary),
    { key: '?', description: 'help' },
    ...(atRoot ? [{ key: 'q', description: 'quit' }] : []),
  ];
  return (
    <Box paddingX={1} flexShrink={0}>
      <Text dimColor wrap="truncate-end">
        {shown.map((hint) => `${hint.key} ${hint.description}`).join(' · ')}
      </Text>
    </Box>
  );
}
