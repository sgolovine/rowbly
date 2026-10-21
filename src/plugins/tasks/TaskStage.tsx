import type { Stage } from '../../plugin-api';
import { StageBadge, Text, theme } from '../../plugin-api/tui';

/** The Stage badge of a Task; an unknown Stage (drift) shows its key in red. */
export function TaskStage({ stages, stage }: { stages: readonly Stage[]; stage: string }) {
  const found = stages.find((s) => s.key === stage);
  return found ? <StageBadge stage={found} /> : <Text color={theme.danger}>● {stage}?</Text>;
}
