import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { theme } from '../theme';

/** Rows with a `›` marker on the cursor row. */
export function CursorRows({ rows, cursor, active }: { rows: ReactNode[]; cursor: number; active: boolean }) {
  return (
    <Box flexDirection="column">
      {rows.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional.
        <Box key={i} backgroundColor={i === cursor && active ? theme.selection : undefined}>
          <Text color={i === cursor && active ? theme.accent : theme.inkFaint}>{i === cursor ? '▌ ' : '  '}</Text>
          {row}
        </Box>
      ))}
    </Box>
  );
}
