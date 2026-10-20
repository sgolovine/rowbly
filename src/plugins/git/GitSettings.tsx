import type { PluginScreenProps } from '../../plugin-api';
import { Box, Form, Loading, Text, useAsync } from '../../plugin-api/tui';
import { configure, preferences } from './model';

export function GitSettings({ plugin, ui }: PluginScreenProps) {
  const loaded = useAsync(
    async () => ({ prefs: await preferences(plugin), defaults: await plugin.git.info() }),
    [plugin],
  );
  if (!loaded.data)
    return loaded.loading ? (
      <Loading label="Loading Git settings…" />
    ) : (
      <Text color="red">Could not load Git settings.</Text>
    );
  const { prefs, defaults } = loaded.data;
  return (
    <Box flexDirection="column">
      <Text bold>Git automatic commits</Text>
      <Text>Git directory: {defaults.root}</Text>
      <Text>Commit message: chore: update Rowbly data</Text>
      <Text>Interval commits run while Rowbly is open; pending changes resume on the next run.</Text>
      <Text>
        Blank author fields use Git configuration: {defaults.authorName} &lt;{defaults.authorEmail}&gt;
      </Text>
      <Form
        fields={[
          {
            name: 'frequency',
            label: 'Frequency',
            kind: 'select',
            options: ['Whenever a change is made', 'On an interval'],
            required: true,
          },
          { name: 'intervalSeconds', label: 'Interval (seconds, 1–86400)', kind: 'number', required: true },
          { name: 'authorName', label: 'Author name', kind: 'text' },
          { name: 'authorEmail', label: 'Author email', kind: 'text' },
        ]}
        initialValues={{
          frequency: prefs.frequency === 'change' ? 'Whenever a change is made' : 'On an interval',
          intervalSeconds: prefs.intervalSeconds,
          authorName: prefs.authorName ?? '',
          authorEmail: prefs.authorEmail ?? '',
        }}
        onSubmit={async (values) => {
          await configure(plugin, {
            frequency: values.frequency === 'On an interval' ? 'interval' : 'change',
            intervalSeconds: values.intervalSeconds,
            authorName: values.authorName || undefined,
            authorEmail: values.authorEmail || undefined,
          });
          ui.toast('Updated Git commit preferences');
          ui.back();
        }}
      />
    </Box>
  );
}
