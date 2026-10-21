import type { PluginScreenProps } from '../../plugin-api';
import {
  Box,
  Loading,
  SelectList,
  Text,
  theme,
  useAsync,
  useInput,
  useIsActive,
  useKeyHints,
  useReloadOnReturn,
  useState,
} from '../../plugin-api/tui';
import type { EpicMode } from './model';
import { listEpicSummaries, progressText } from './service';

function nextEpicMode(mode: EpicMode): EpicMode {
  switch (mode) {
    case 'open':
      return 'closed';
    case 'closed':
      return 'all';
    case 'all':
      return 'open';
  }
}

export function EpicList({ plugin, ui }: PluginScreenProps<Record<string, unknown>>) {
  const active = useIsActive();
  const [mode, setMode] = useState<EpicMode>('open');
  const data = useAsync(() => listEpicSummaries(plugin, mode), [plugin, mode]);
  // Back from an Epic or its form shows what changed there.
  useReloadOnReturn(data.reload);
  useKeyHints([
    { key: 'n', description: 'new Epic' },
    { key: 'a', description: 'open/closed/all' },
    { key: 'enter', description: 'open Epic' },
  ]);
  useInput(
    (input) => {
      if (input === 'n') ui.open('form', { title: 'New Epic' });
      else if (input === 'a') setMode(nextEpicMode);
    },
    { isActive: active },
  );
  if (!data.data)
    return data.loading ? <Loading label="Loading Epics…" /> : <Text color={theme.danger}>Could not load Epics.</Text>;
  const { summaries, unavailable } = data.data;
  return (
    <Box flexDirection="column">
      <Text bold>{`Epics (${mode})`}</Text>
      <SelectList
        items={[
          ...summaries.map((epic) => ({
            value: epic.id,
            label: `${epic.id} · ${epic.name}`,
            description: `${epic.closed ? 'closed · ' : ''}${progressText(epic.progress)}`,
          })),
          ...unavailable.map((file) => ({
            value: file.id,
            label: `${file.id} · unavailable`,
            description: `${file.path}: ${file.message}`,
          })),
        ]}
        emptyText="No Epics."
        onSelect={({ value }) => {
          const broken = unavailable.find((file) => file.id === value);
          if (broken) ui.toast(`Epic "${broken.id}" is unavailable; run \`rowbly doctor\``, 'warning');
          else ui.open('detail', { id: value, title: value });
        }}
      />
    </Box>
  );
}
