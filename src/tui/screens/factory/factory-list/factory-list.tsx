import { Box, Text } from "ink";
import { type Dispatch, type ReactNode, type SetStateAction, useEffect, useState } from "react";
import { theme } from "../../../theme.js";
import { FactoryListItem } from "../factory-list-item/index.js";

/** The most rows that a list shows; a `↓ n more` row follows. */
const LIST_LIMIT = 5;

/** One row of a `FactoryList`. */
interface FactoryListRow {
  readonly key: string;
  readonly node: ReactNode;
  /**
   * The action of a click on the selected row. A row with an action can be selected: the first click
   * selects it, and a click on the selected row runs the action.
   */
  readonly onClick?: () => void;
}

/** The props of `FactoryList`. */
export interface FactoryListProps {
  readonly title: string;
  readonly rows: readonly FactoryListRow[];
  /** False while a dialog or a different view has the keys; then the rows do not take a click. */
  readonly clickable?: boolean;
}

/** The key of the selected row, or `undefined` when no shown row has that key. */
function shownKey(rows: readonly FactoryListRow[], key: string | undefined): string | undefined {
  return rows.some((row) => row.key === key) ? key : undefined;
}

/** A click on the selected row runs its action. A click on a different row only selects it. */
function clickRow(
  row: FactoryListRow,
  selected: string | undefined,
  select: Dispatch<SetStateAction<string | undefined>>,
): void {
  if (row.key === selected) {
    row.onClick?.();

    return;
  }

  select(row.key);
}

/** The selection of a row with an action: `true` or `false`. A row without an action has no selection. */
function rowSelection(row: FactoryListRow, selected: string | undefined): boolean | undefined {
  return row.onClick ? row.key === selected : undefined;
}

/** A list of the Factory controls with a title, cut at five rows. It shows nothing when there are no rows. */
export function FactoryList({ title, rows, clickable = false }: FactoryListProps) {
  const [selectedKey, setSelectedKey] = useState<string>();

  const shown = rows.slice(0, LIST_LIMIT);
  const selected = shownKey(shown, selectedKey);

  // A selected row that went away leaves no selection, also when a row with the same key comes back.
  useEffect(() => {
    if (selectedKey !== selected) {
      setSelectedKey(selected);
    }
  }, [selectedKey, selected]);

  if (rows.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column">
      <Text color={theme.inkMuted}>{title}</Text>
      {shown.map((row) => (
        <FactoryListItem
          key={row.key}
          onClick={row.onClick && (() => clickRow(row, selected, setSelectedKey))}
          clickable={clickable}
          selected={rowSelection(row, selected)}
        >
          {row.node}
        </FactoryListItem>
      ))}
      {rows.length > LIST_LIMIT && <Text color={theme.inkFaint}>↓ {rows.length - LIST_LIMIT} more</Text>}
    </Box>
  );
}
