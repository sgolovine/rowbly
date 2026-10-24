import type { PluginBoardSectionProps } from '../../plugin-api';
import { Text, useAsync, useReloadOnReturn } from '../../plugin-api/tui';
import { listSpecs, specLine } from './specs';

export function SpecsSection({ board, plugin }: PluginBoardSectionProps<Record<string, unknown>>) {
  const specs = useAsync(() => listSpecs(plugin, board.id), [plugin, board.id]);
  useReloadOnReturn(specs.reload);
  // A reload keeps the Specs on screen until the new ones load.
  const summary =
    !specs.data && specs.loading
      ? 'Loading…'
      : specs.error
        ? 'Could not load Specs.'
        : (specs.data ?? []).map(specLine).join(' · ') || 'none';
  return (
    <Text>
      <Text bold>Board Specs: </Text>
      {summary}
    </Text>
  );
}
