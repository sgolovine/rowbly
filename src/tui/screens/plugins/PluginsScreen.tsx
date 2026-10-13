import { Box, Text } from 'ink';
import { useState } from 'react';
import { onOff, type PluginStatus } from '../../../services';
import { Loading, SelectList } from '../../components';
import { useAsync, useKeyHints, usePlugins, useServices, useToast } from '../../hooks';

/** The Plugins section of the settings, like `rowbly plugins`: `enter` turns the selected Plugin on or off. */
export function PluginsScreen() {
  const services = useServices();
  const toast = useToast();
  const { reload } = usePlugins();
  const list = useAsync(() => services.plugins.list(), [services]);
  const [selected, setSelected] = useState<PluginStatus | undefined>();
  useKeyHints([{ key: 'enter', description: 'turn on/off' }]);

  if (!list.data) return list.loading ? <Loading label="Loading Plugins…" /> : null;
  if (list.data.length === 0) return <Text dimColor>This version of Rowbly has no Built-in Plugins.</Text>;
  const plugins = list.data;

  const toggle = async (id: string) => {
    const plugin = plugins.find((p) => p.id === id);
    if (!plugin) return;
    try {
      if (plugin.enabled) await services.plugins.disable(id);
      else await services.plugins.enable(id);
      toast.push('info', `Turned ${plugin.enabled ? 'off' : 'on'} Plugin ${plugin.name}`);
      await reload();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Box flexDirection="column" gap={1}>
      <SelectList
        items={plugins.map((p) => ({
          value: p.id,
          label: `${p.loaded ? '●' : '○'} ${p.name}`,
          description: p.known ? onOff(p) : `${onOff(p)} · not in this version of Rowbly`,
        }))}
        onHighlight={(item) => setSelected(plugins.find((p) => p.id === item?.value))}
        onSelect={(item) => void toggle(item.value)}
      />
      {selected && (
        <Box flexDirection="column">
          {selected.description && <Text>{selected.description}</Text>}
          {selected.reason && <Text color="red">{`Failed to load: ${selected.reason}`}</Text>}
          <Text dimColor>Turning a Plugin off keeps its settings and data.</Text>
        </Box>
      )}
    </Box>
  );
}
