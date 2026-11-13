import { Box, Text } from "ink";
import type { Stage } from "../../../../services/stage/stage.js";
import { SelectionRow, StageBadge, Switch } from "../../../components/index.js";
import { theme } from "../../../theme.js";
import { stageCategory } from "../../stories/index.js";

/** The props of `StageRow`. */
export interface StageRowProps {
  readonly stage: Stage;
  /** All Stages in board order, for the category of the badge. */
  readonly stages: readonly Stage[];
  readonly selected: boolean;
  /** False while a Form has the keys; then the row and its Switch do not take a click. */
  readonly idle: boolean;
  /** The columns of the badge and the key, so that the rows line up. */
  readonly labelWidth: number;
  readonly keyWidth: number;
  readonly onClick: () => void;
  readonly onToggle: () => void;
}

/** One Stage in the settings list: its badge, its key and a Switch that enables or disables it. */
export function StageRow({ stage, stages, selected, idle, labelWidth, keyWidth, onClick, onToggle }: StageRowProps) {
  return (
    <SelectionRow selected={selected} active={idle} onClick={onClick}>
      <Box>
        <Box width={labelWidth} flexShrink={0}>
          <StageBadge stage={{ name: stage.label, category: stageCategory(stages, stage.key) }} />
        </Box>
        <Box width={keyWidth} flexShrink={0}>
          <Text color={selected ? theme.inkMuted : theme.inkFaint}>{stage.key}</Text>
        </Box>
        <Switch on={stage.enabled} onLabel="Enabled" offLabel="Disabled" onChange={onToggle} clickable={idle} />
      </Box>
    </SelectionRow>
  );
}
