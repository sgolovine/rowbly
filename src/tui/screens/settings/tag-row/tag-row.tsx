import { Box, Text } from "ink";
import type { TagConfig } from "../../../../services/config/config.js";
import { SelectionRow } from "../../../components/index.js";
import { theme } from "../../../theme.js";

/** The props of `TagRow`. */
export interface TagRowProps {
  readonly tag: TagConfig;
  readonly selected: boolean;
  /** False while a Form or a dialog has the keys; then the row does not take a click. */
  readonly active: boolean;
  /** The column of the label, so that the values line up. */
  readonly labelWidth: number;
  readonly onClick: () => void;
}

/** One tag in the settings list: its label and its value. */
export function TagRow({ tag, selected, active, labelWidth, onClick }: TagRowProps) {
  return (
    <SelectionRow selected={selected} active={active} onClick={onClick}>
      <Box>
        <Box width={labelWidth} flexShrink={0}>
          <Text color={theme.ink} bold={selected}>
            {tag.label}
          </Text>
        </Box>
        <Text color={selected ? theme.inkMuted : theme.inkFaint} wrap="truncate-end">
          {tag.value}
        </Text>
      </Box>
    </SelectionRow>
  );
}
