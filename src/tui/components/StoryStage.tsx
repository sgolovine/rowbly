import { Text } from 'ink';
import type { Stage, Story } from '../../schemas';
import { StageBadge } from './StageBadge';

/** The Stage badge for a Story; an unknown Stage (drift) shows its key in red. */
export function StoryStage({ stages, story }: { stages: readonly Stage[]; story: Pick<Story, 'stage'> }) {
  const stage = stages.find((s) => s.key === story.stage);
  return stage ? <StageBadge stage={stage} /> : <Text color="red">● {story.stage}?</Text>;
}
