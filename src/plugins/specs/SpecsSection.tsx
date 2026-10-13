import type { PluginBoardSectionProps } from '../../plugin-api';
import { Text, useAsync } from '../../plugin-api/tui';
import { listSpecs } from './specs';

export function SpecsSection({ board, plugin }: PluginBoardSectionProps<Record<string, unknown>>) {
  const specs = useAsync(() => listSpecs(plugin, board.id), [plugin, board.id]);
  return (
    <Text>
      <Text bold>Board Specs: </Text>
      {specs.loading ? 'Loading…' : (specs.data ?? []).map((s) => `${s.slug}  ${s.title}`).join(' · ') || 'none'}
    </Text>
  );
}
