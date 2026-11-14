import { Box, Text } from "ink";
import type { Stage } from "../../../../services/stage/stage.js";
import { SelectionRow, StageBadge } from "../../../components/index.js";
import { theme } from "../../../theme.js";
import { stageCategory } from "../../stories/stage-category.js";
import { columnWidth } from "../column-width.js";

/** One row of the list: a Stage and the model text of the row. */
export interface StageModelItem {
  readonly stage: Stage;
  /** The model text, for example `acme/deep-1 · thinking high` or `Worker model: Pi default`. */
  readonly value: string;
  /** True when the row has no override of its own, so the value comes from a different setting. */
  readonly inherited: boolean;
}

/** The props of `StageModelList`. */
export interface StageModelListProps {
  readonly items: readonly StageModelItem[];
  /** The index of the highlighted row. */
  readonly cursor: number;
  /** The list has the keys, so the highlighted row stays in view. */
  readonly active: boolean;
  /** The rows take a click: Pi has loaded, and no task is on top. */
  readonly clickable: boolean;
  readonly onPick: (index: number) => void;
}

/** The colour of a value. `ink-faint` is not on the `selection` fill. */
function valueColor(item: StageModelItem, selected: boolean): string {
  if (!item.inherited) {
    return theme.ink;
  }

  return selected ? theme.inkMuted : theme.inkFaint;
}

/** One row for each Stage, in board order: the Stage badge, then the worker model of the Stage. */
export function StageModelList({ items, cursor, active, clickable, onPick }: StageModelListProps) {
  const stages = items.map((item) => item.stage);
  const labelWidth = columnWidth(
    stages.map((stage) => stage.label),
    4,
  );

  return (
    <Box flexDirection="column" flexShrink={0}>
      {items.map((item, index) => (
        <SelectionRow
          key={item.stage.key}
          selected={index === cursor}
          active={active}
          onClick={clickable ? () => onPick(index) : undefined}
        >
          <Box>
            <Box width={labelWidth} flexShrink={0}>
              <StageBadge stage={{ name: item.stage.label, category: stageCategory(stages, item.stage.key) }} />
            </Box>
            <Text color={valueColor(item, index === cursor)} wrap="truncate-end">
              {item.value}
            </Text>
          </Box>
        </SelectionRow>
      ))}
    </Box>
  );
}
