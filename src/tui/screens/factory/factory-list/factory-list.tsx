import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { theme } from "../../../theme.js";
import { FactoryListItem } from "../factory-list-item/index.js";

/** The most rows that a list shows; a `↓ n more` row follows. */
const LIST_LIMIT = 5;

/** One row of a `FactoryList`. */
interface FactoryListRow {
  readonly key: string;
  readonly node: ReactNode;
  /** The action of a click on the row. */
  readonly onClick?: () => void;
}

/** The props of `FactoryList`. */
export interface FactoryListProps {
  readonly title: string;
  readonly rows: readonly FactoryListRow[];
  /** False while a dialog or a different view has the keys; then the rows do not take a click. */
  readonly clickable?: boolean;
}

/** A list of the Factory controls with a title, cut at five rows. It shows nothing when there are no rows. */
export function FactoryList({ title, rows, clickable = false }: FactoryListProps) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column">
      <Text color={theme.inkMuted}>{title}</Text>
      {rows.slice(0, LIST_LIMIT).map((row) => (
        <FactoryListItem key={row.key} onClick={row.onClick} clickable={clickable}>
          {row.node}
        </FactoryListItem>
      ))}
      {rows.length > LIST_LIMIT && <Text color={theme.inkFaint}>↓ {rows.length - LIST_LIMIT} more</Text>}
    </Box>
  );
}
