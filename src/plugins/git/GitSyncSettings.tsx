import type { PluginScreenProps } from '../../plugin-api';
import { Box, Form, Loading, Text, theme, useAsync } from '../../plugin-api/tui';
import { configure, preferences } from './model';

export function GitSyncSettings({ plugin, ui }: PluginScreenProps) {
  const loaded = useAsync(() => preferences(plugin), [plugin]);
  if (!loaded.data)
    return loaded.loading ? <Loading /> : <Text color={theme.danger}>Could not load Git preferences.</Text>;
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Automatic Merge Conflict Resolution</Text>
      <Text>Save with ctrl+s. Off prevents future runs; an admitted run may finish, including push.</Text>
      <Form
        fields={[
          {
            name: 'enabled',
            label: 'Automatic Merge Conflict Resolution',
            kind: 'select',
            options: ['Off', 'On'],
            required: true,
          },
          { name: 'intervalSeconds', label: 'Merge interval (seconds, 1–86400)', kind: 'number', required: true },
        ]}
        initialValues={{
          enabled: loaded.data.synchronization.enabled ? 'On' : 'Off',
          intervalSeconds: loaded.data.synchronization.intervalSeconds,
        }}
        onSubmit={async (values) => {
          await configure(plugin, {
            synchronization: { enabled: values.enabled === 'On', intervalSeconds: values.intervalSeconds },
          });
          ui.toast('Updated Automatic Merge Conflict Resolution preferences');
          ui.back();
        }}
      />
    </Box>
  );
}
