import { Box, Text } from "ink";
import type { CheckSpec } from "../../../../services/factory-settings/factory-settings.js";
import { SelectionRow } from "../../../components/index.js";
import { theme } from "../../../theme.js";
import { columnWidth } from "../column-width.js";

/** The props of `CheckList`. */
export interface CheckListProps {
  readonly checks: readonly CheckSpec[];
  /** The index of the highlighted row. */
  readonly cursor: number;
  /** The list has the keys, and the rows take a click. */
  readonly active: boolean;
  readonly onPick: (index: number) => void;
}

function nameText(check: CheckSpec): string {
  return check.label === check.key ? check.key : `${check.label} (${check.key})`;
}

function scopeText(check: CheckSpec): string {
  return check.narrowCommand ? "full + narrow" : "full";
}

/** One row for each check: its name, its forms and its full command. */
export function CheckList({ checks, cursor, active, onPick }: CheckListProps) {
  const nameWidth = columnWidth(checks.map(nameText), 4);
  const scopeWidth = columnWidth(checks.map(scopeText), 2);

  return (
    <Box flexDirection="column" flexShrink={0}>
      {checks.map((check, index) => (
        <SelectionRow
          key={check.key}
          selected={index === cursor}
          active={active}
          onClick={active ? () => onPick(index) : undefined}
        >
          <Box>
            <Box width={nameWidth} flexShrink={0}>
              <Text color={theme.ink}>{nameText(check)}</Text>
            </Box>
            <Box width={scopeWidth} flexShrink={0}>
              <Text color={theme.inkMuted}>{scopeText(check)}</Text>
            </Box>
            <Text color={theme.inkMuted} wrap="truncate-end">
              {check.command}
            </Text>
          </Box>
        </SelectionRow>
      ))}
    </Box>
  );
}
