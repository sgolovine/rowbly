import type { PluginScreenProps } from '../../plugin-api';
import {
  Box,
  Loading,
  SelectList,
  Text,
  useAsync,
  useInput,
  useIsActive,
  useKeyHints,
  useState,
} from '../../plugin-api/tui';
import { listEpics, progressText, showEpic } from './service';

export function EpicList({ plugin, ui }: PluginScreenProps<Record<string, unknown>>) {
  const active = useIsActive();
  const [mode, setMode] = useState<'open' | 'closed' | 'all'>('open');
  const data = useAsync(async () => {
    const epics = await listEpics(plugin, mode);
    return Promise.all(epics.map((epic) => showEpic(plugin, epic.id)));
  }, [plugin, mode, active]);
  useKeyHints([
    { key: 'n', description: 'new Epic' },
    { key: 'a', description: 'open/closed/all' },
    { key: 'enter', description: 'open Epic' },
  ]);
  useInput(
    (input) => {
      if (input === 'n') ui.open('form', { title: 'New Epic' });
      else if (input === 'a') setMode((value) => (value === 'open' ? 'closed' : value === 'closed' ? 'all' : 'open'));
    },
    { isActive: active },
  );
  if (!data.data)
    return data.loading ? <Loading label="Loading Epics…" /> : <Text color="red">Could not load Epics.</Text>;
  return (
    <Box flexDirection="column">
      <Text bold>{`Epics (${mode})`}</Text>
      <SelectList
        items={data.data.map((epic) => ({
          value: epic.id,
          label: `${epic.id} · ${epic.name}`,
          description: `${epic.closed ? 'closed · ' : ''}${progressText(epic.progress)}`,
        }))}
        emptyText="No Epics."
        onSelect={({ value }) => ui.open('detail', { id: value, title: value })}
      />
    </Box>
  );
}
