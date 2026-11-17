import { Box, Text } from "ink";
import { theme } from "../../theme.js";
import { type RowDragProps, SelectionRow } from "../selection-row/index.js";

/** The lines of a `SectionHeadingRow`: the heading, and the empty line above it when it is `spaced`. */
export function sectionHeadingRowHeight(spaced: boolean): number {
  return spaced ? 2 : 1;
}

/**
 * The heading of a section of a list: `▾`/`▸`, the name of the section and its count of items. An empty,
 * expanded section also shows `emptyText` after the count. `spaced` puts one empty line above the heading,
 * outside the highlight of the selection. The `RowDragProps` let the mouse drop a value on the heading.
 */
export function SectionHeadingRow({
  label,
  count,
  collapsed,
  selected,
  clickable,
  onClick,
  emptyText,
  spaced = false,
  ...dragProps
}: {
  label: string;
  count: number;
  collapsed: boolean;
  selected: boolean;
  clickable: boolean;
  onClick(): void;
  /** The text after the count of an empty, expanded section, for example `No Stories`. */
  emptyText: string;
  spaced?: boolean;
} & RowDragProps) {
  return (
    <Box flexDirection="column" marginTop={spaced ? 1 : 0}>
      <SelectionRow selected={selected} active={clickable} onClick={onClick} {...dragProps}>
        <Box paddingRight={1}>
          <Text wrap="truncate-end">
            <Text color={theme.inkFaint}>{collapsed ? "▸" : "▾"} </Text>
            <Text color={theme.ink} bold>
              {label}
            </Text>
            <Text color={selected ? theme.inkMuted : theme.inkFaint}>
              {" "}
              ({count}){count === 0 && !collapsed ? `  ${emptyText}` : ""}
            </Text>
          </Text>
        </Box>
      </SelectionRow>
    </Box>
  );
}
