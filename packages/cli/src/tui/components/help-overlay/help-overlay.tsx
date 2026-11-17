import { Box, Text } from "ink";
import { GLOBAL_KEYS, type KeyHint } from "../../keymap.js";
import { theme } from "../../theme.js";

/** The keys of the screen and the global keys of the shell, one key on each row. */
export function HelpOverlay({
  hints,
  globals = GLOBAL_KEYS,
}: {
  hints: readonly KeyHint[];
  /** The shell's keys that work here; all of them unless the shell hides some of its frame. */
  globals?: readonly KeyHint[];
}) {
  // A screen's own meaning for a key (e.g. `/` on the board, `esc` in a form) replaces the global one.
  const rows = [...hints, ...globals.filter((global) => !hints.some((hint) => hint.key === global.key))];
  const width = Math.max(...rows.map((row) => row.key.length)) + 2;

  return (
    <Box flexDirection="column">
      {rows.map((row) => (
        <Text key={`${row.key}:${row.description}`}>
          <Text color={theme.accent}>{row.key.padEnd(width)}</Text>
          {row.description}
        </Text>
      ))}
    </Box>
  );
}
