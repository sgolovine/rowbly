import type { PluginBoardSectionProps } from '../../plugin-api';
import { Text, useAsync } from '../../plugin-api/tui';
import { listSpecs, specLine } from './specs';

export function SpecsSection({ board, plugin }: PluginBoardSectionProps<Record<string, unknown>>) {
  const specs = useAsync(() => listSpecs(plugin, board.id), [plugin, board.id]);
  const summary = specs.loading
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
