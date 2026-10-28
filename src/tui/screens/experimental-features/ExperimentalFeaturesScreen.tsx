import { Box, Text } from 'ink';
import { useRef, useState } from 'react';
import { Loading, SelectList } from '../../components';
import { useAsync, useKeyHints, useReloadOnReturn, useServices, useToast } from '../../hooks';
import { theme } from '../../theme';

/** Data Root Experimental Features; `enter` saves the selected feature's opposite value. */
export function ExperimentalFeaturesScreen() {
  const services = useServices();
  const toast = useToast();
  const list = useAsync(() => services.featureFlags.list(), [services]);
  useReloadOnReturn(list.reload);
  const [selectedKey, setSelectedKey] = useState<string>();
  const saving = useRef(false);
  useKeyHints(list.data?.length ? [{ key: 'enter', description: 'turn on/off' }] : []);

  if (!list.data) return list.loading ? <Loading label="Loading Experimental Features…" /> : null;
  if (list.data.length === 0)
    return (
      <Box flexDirection="column" gap={1}>
        <Text color={theme.inkFaint}>This version of Rowbly has no Experimental Features.</Text>
        <Text color={theme.inkFaint}>Features will appear here when they are available to try.</Text>
      </Box>
    );
  const selected = list.data.find((flag) => flag.key === selectedKey);
  const toggle = async (key: string) => {
    if (saving.current) return;
    saving.current = true;
    try {
      const enabled = await services.featureFlags.isEnabled(key);
      const flag = await services.featureFlags.set(key, !enabled);
      toast.push('info', `Turned ${flag.enabled ? 'on' : 'off'} ${flag.name}`);
      list.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      saving.current = false;
    }
  };

  return (
    <Box flexDirection="column" gap={1}>
      <SelectList
        items={list.data.map((flag) => ({
          value: flag.key,
          label: flag.name,
          description: flag.enabled ? 'on' : 'off',
        }))}
        onHighlight={(item) => setSelectedKey(item?.value)}
        onSelect={(item) => void toggle(item.value)}
      />
      {selected && <Text color={theme.ink}>{selected.description}</Text>}
      <Text color={theme.inkFaint}>Saved for every Board in this Data Root.</Text>
    </Box>
  );
}
