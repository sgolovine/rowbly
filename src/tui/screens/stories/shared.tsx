// Pieces shared by the story list, detail and form screens.
import { Text } from 'ink';
import { useEffect, useRef } from 'react';
import type { Slug, Stage, Story } from '../../../schemas';
import type { Services } from '../../../services';
import { StageBadge } from '../../components';
import { useIsActive } from '../../hooks';

/** The select choice meaning "no value" (no Priority, an unset Custom Field). */
export const NONE = '(none)';

/** `params.boardId` when given, else the Board in context. */
export async function boardIdFor(services: Services, params: Record<string, unknown>): Promise<Slug> {
  return (params.boardId as Slug | undefined) ?? services.context.resolveBoard();
}

/** Calls `reload` when the screen becomes active again, e.g. after a pushed screen is closed. */
export function useReloadOnReturn(reload: () => void): void {
  const active = useIsActive();
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) reload();
    wasActive.current = active;
  }, [active, reload]);
}

/** The Stage badge for a Story; an unknown Stage (drift) shows its key in red. */
export function StoryStage({ stages, story }: { stages: readonly Stage[]; story: Pick<Story, 'stage'> }) {
  const stage = stages.find((s) => s.key === story.stage);
  return stage ? <StageBadge stage={stage} /> : <Text color="red">● {story.stage}?</Text>;
}
