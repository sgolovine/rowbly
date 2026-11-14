import { Box, Text } from "ink";
import { SelectionRow } from "../../../components/index.js";
import { theme } from "../../../theme.js";

/**
 * The heading of a section of the Factory view: `▾`/`▸`, the name of the section and its count of Threads.
 * `spaced` puts one empty line above the heading, outside the highlight of the selection.
 */
export function ThreadSectionRow({
  label,
  count,
  collapsed,
  selected,
  clickable,
  onClick,
  spaced = false,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  selected: boolean;
  clickable: boolean;
  onClick(): void;
  spaced?: boolean;
}) {
  return (
    <Box flexDirection="column" marginTop={spaced ? 1 : 0}>
      <SelectionRow selected={selected} active={clickable} onClick={onClick}>
        <Box paddingRight={1}>
          <Text wrap="truncate-end">
            <Text color={theme.inkFaint}>{collapsed ? "▸" : "▾"} </Text>
            <Text color={theme.ink} bold>
              {label}
            </Text>
            <Text color={selected ? theme.inkMuted : theme.inkFaint}>
              {" "}
              ({count}){count === 0 && !collapsed ? "  No Threads" : ""}
            </Text>
          </Text>
        </Box>
      </SelectionRow>
    </Box>
  );
}
