import { Text } from "ink";
import type { TagConfig } from "../../../../services/config/config.js";
import { ColumnRow, subtleColor } from "../../../components/index.js";
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
    <ColumnRow
      selected={selected}
      active={active}
      onClick={onClick}
      columns={[
        {
          width: labelWidth,
          content: (
            <Text color={theme.ink} bold={selected}>
              {tag.label}
            </Text>
          ),
        },
        {
          content: (
            <Text color={subtleColor(selected)} wrap="truncate-end">
              {tag.value}
            </Text>
          ),
        },
      ]}
    />
  );
}
