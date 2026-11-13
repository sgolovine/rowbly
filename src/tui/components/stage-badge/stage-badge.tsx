import { Text } from "ink";
import { stageColors } from "../../theme.js";

/** The colour family of a Stage: waiting (`backlog`), in flight (`board`) or finished (`done`). */
export type StageCategory = keyof typeof stageColors;

/** Stage colour always travels with its name. */
export function StageBadge({ stage }: { stage: { name: string; category: StageCategory } }) {
  return <Text color={stageColors[stage.category]}>● {stage.name}</Text>;
}
