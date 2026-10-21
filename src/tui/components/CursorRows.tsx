import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { theme } from '../theme';

/** Rows with a `›` marker on the cursor row. */
export function CursorRows({ rows, cursor }: { rows: ReactNode[]; cursor: number }) {
  return (
    <Box flexDirection="column">
      {rows.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional.
        <Box key={i} backgroundColor={i === cursor ? theme.selection : undefined}>
          <Text color={theme.accent}>{i === cursor ? '▌ ' : '  '}</Text>
          {row}
        </Box>
      ))}
    </Box>
  );
}
