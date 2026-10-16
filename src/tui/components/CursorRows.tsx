import { Box, Text } from 'ink';
import type { ReactNode } from 'react';

/** Rows with a `›` marker on the cursor row. */
export function CursorRows({ rows, cursor, active }: { rows: ReactNode[]; cursor: number; active: boolean }) {
  return (
    <Box flexDirection="column">
      {rows.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional.
        <Box key={i}>
          <Text color={i === cursor && active ? 'cyan' : undefined}>{i === cursor ? '› ' : '  '}</Text>
          {row}
        </Box>
      ))}
    </Box>
  );
}
