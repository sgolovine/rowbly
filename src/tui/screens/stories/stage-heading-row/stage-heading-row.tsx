import { Box, Text } from "ink";
import { type RowDragProps, SelectionRow } from "../../../components/index.js";
import { theme } from "../../../theme.js";

/**
 * The heading of a Stage section in the Story list: `▾`/`▸`, the Stage name and its count of Stories. The
 * `RowDragProps` let the mouse drop a Story on it.
 */
export function StageHeadingRow({
  label,
  count,
  collapsed,
  selected,
  clickable,
  onClick,
  ...dragProps
}: {
  label: string;
  count: number;
  collapsed: boolean;
  selected: boolean;
  clickable: boolean;
  onClick(): void;
} & RowDragProps) {
  return (
    <SelectionRow selected={selected} active={clickable} onClick={onClick} {...dragProps}>
      <Box paddingRight={1}>
        <Text wrap="truncate-end">
          <Text color={theme.inkFaint}>{collapsed ? "▸" : "▾"} </Text>
          <Text color={theme.ink} bold>
            {label}
          </Text>
          <Text color={theme.inkFaint}>
            {" "}
            ({count}){count === 0 && !collapsed ? "  No Stories" : ""}
          </Text>
        </Text>
      </Box>
    </SelectionRow>
  );
}
