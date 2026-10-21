import { Text } from 'ink';
import type { Stage } from '../../schemas';
import { stageColors } from '../theme';

/** Stage colour always travels with its name. */
export function StageBadge({ stage }: { stage: Pick<Stage, 'name' | 'category'> }) {
  return <Text color={stageColors[stage.category]}>● {stage.name}</Text>;
}
