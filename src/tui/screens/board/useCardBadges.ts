import { useCallback, useMemo } from 'react';
import type { Stage, Story } from '../../../schemas';
import { usePlugins, useServices } from '../../hooks';

/**
 * The texts the Plugins that are on add to a Story's board card (`PluginTui.cardBadge`), in registry
 * order. A badge only shows something, so a Plugin whose badge throws adds none to that card.
 */
export function useCardBadges(): (story: Story, stages: readonly Stage[]) => string[] {
  const services = useServices();
  const { plugins } = usePlugins();
  const badgers = useMemo(
    () =>
      plugins.flatMap((p) => {
        const badge = p.tui.cardBadge;
        return badge ? [{ badge, plugin: services.plugins.context(p.id) }] : [];
      }),
    [plugins, services],
  );
  return useCallback(
    (story, stages) =>
      badgers.flatMap(({ badge, plugin }) => {
        try {
          return badge({ story, stages, plugin }) ?? [];
        } catch {
          return [];
        }
      }),
    [badgers],
  );
}
