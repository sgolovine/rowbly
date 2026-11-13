import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { theme } from "../../../theme.js";

/** The most rows that a list shows; a `↓ n more` row follows. */
const LIST_LIMIT = 5;

/** One row of a `FactoryList`. */
export interface FactoryListRow {
  readonly key: string;
  readonly node: ReactNode;
}

/** A list of the Factory controls with a title, cut at five rows. It shows nothing when there are no rows. */
export function FactoryList({ title, rows }: { title: string; rows: readonly FactoryListRow[] }) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column">
      <Text color={theme.inkMuted}>{title}</Text>
      {rows.slice(0, LIST_LIMIT).map((row) => (
        <Box key={row.key}>{row.node}</Box>
      ))}
      {rows.length > LIST_LIMIT && <Text color={theme.inkFaint}>↓ {rows.length - LIST_LIMIT} more</Text>}
    </Box>
  );
}
