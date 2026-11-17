import { Box, type DOMElement, Text } from "ink";
import { type Dispatch, type ReactNode, type SetStateAction, useEffect, useRef, useState } from "react";
import { clampOffset } from "../../../components/scroll-offset.js";
import { useMouse } from "../../../hooks/index.js";
import { theme } from "../../../theme.js";
import { FactoryListItem } from "../factory-list-item/index.js";

/** The most rows that a list shows; a `↓ n more` row follows. */
export const FACTORY_LIST_LIMIT = 5;

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
  /** The index of the first row in the window of a list that scrolls. The list keeps it in range. */
  readonly offset?: number;
  /** Makes the list scroll: a wheel notch over the list calls it with `-1` (up) or `1` (down). */
  readonly onScroll?: (direction: -1 | 1) => void;
}

/** The largest offset of the window for `count` rows. */
export function factoryListMaxOffset(count: number): number {
  return Math.max(0, count - FACTORY_LIST_LIMIT);
}

/** The key of the selected row, or `undefined` when no row has that key. */
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

/**
 * A list of the Factory controls with a title. It shows a window of five rows. Without `onScroll`, the window
 * stays at the first row. It shows nothing when there are no rows.
 */
export function FactoryList({ title, rows, clickable = false, offset = 0, onScroll }: FactoryListProps) {
  const [selectedKey, setSelectedKey] = useState<string>();
  const ref = useRef<DOMElement>(null);

  const scrollable = onScroll !== undefined;
  const start = scrollable ? clampOffset(offset, factoryListMaxOffset(rows.length)) : 0;
  const shown = rows.slice(start, start + FACTORY_LIST_LIMIT);
  const below = rows.length - start - shown.length;
  const selected = shownKey(scrollable ? rows : shown, selectedKey);

  // A selected row that went away leaves no selection, also when a row with the same key comes back.
  useEffect(() => {
    if (selectedKey !== selected) {
      setSelectedKey(selected);
    }
  }, [selectedKey, selected]);

  useMouse(ref, { onWheel: onScroll }, clickable && scrollable && rows.length > FACTORY_LIST_LIMIT);

  if (rows.length === 0) {
    return null;
  }

  return (
    <Box ref={ref} flexDirection="column">
      <Text color={theme.inkMuted}>{title}</Text>
      {start > 0 && <Text color={theme.inkFaint}>↑ {start} more</Text>}
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
      {below > 0 && <Text color={theme.inkFaint}>↓ {below} more</Text>}
    </Box>
  );
}
