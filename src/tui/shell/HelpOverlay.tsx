import { Box, Text } from 'ink';
import { GLOBAL_KEYS, type KeyHint } from '../keymap';

export function HelpOverlay({ hints }: { hints: readonly KeyHint[] }) {
  // A screen's own meaning for a key (e.g. `/` on the board, `esc` in a form) replaces the global one.
  const rows = [...hints, ...GLOBAL_KEYS.filter((global) => !hints.some((hint) => hint.key === global.key))];
  const width = Math.max(...rows.map((row) => row.key.length)) + 2;
  return (
    <Box flexDirection="column">
      {rows.map((row) => (
        <Text key={`${row.key}:${row.description}`}>
          <Text color="cyan">{row.key.padEnd(width)}</Text>
          {row.description}
        </Text>
      ))}
    </Box>
  );
}
