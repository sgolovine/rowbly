import { Text } from 'ink';
import { colorByCategory } from '../../output';
import type { Stage } from '../../schemas';

/** A Stage name coloured by its Stage Category: backlog dim, board yellow, done green. */
export function StageBadge({ stage }: { stage: Pick<Stage, 'name' | 'category'> }) {
  return <Text>{colorByCategory(stage.category, `● ${stage.name}`)}</Text>;
}
