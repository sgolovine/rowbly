import type { PluginScreenProps } from '../../plugin-api';
import { Box, Form, Loading, Text, theme, useAsync } from '../../plugin-api/tui';
import { listAssignees } from './roster';
import { addAssignee, editAssignee } from './service';

/** Adds an Assignee, or edits the name and email of `params.handle`. */
export function AssigneeForm({ params, plugin, ui }: PluginScreenProps<Record<string, unknown>>) {
  const handle = typeof params.handle === 'string' ? params.handle : undefined;
  const roster = useAsync(() => listAssignees(plugin), [plugin]);
  if (!roster.data)
    return roster.loading ? (
      <Loading label="Loading assignee…" />
    ) : (
      <Text color={theme.danger}>Could not load Assignee.</Text>
    );
  const current = handle ? roster.data.find((a) => a.handle === handle) : undefined;
  if (handle && !current) return <Text color={theme.inkFaint}>Assignee "{handle}" is no longer in the roster.</Text>;

  return (
    <Box flexDirection="column">
      <Text bold>{current ? `Edit Assignee ${current.handle}` : 'New Assignee'}</Text>
      <Form
        fields={[
          ...(current ? [] : [{ name: 'handle', label: 'Handle', kind: 'text' as const, required: true }]),
          { name: 'name', label: 'Name', kind: 'text', required: true },
          { name: 'email', label: 'Email', kind: 'text' },
        ]}
        initialValues={current ? { name: current.name, email: current.email ?? '' } : {}}
        onSubmit={async (values) => {
          const name = String(values.name);
          const email = String(values.email ?? '');
          if (current) {
            await editAssignee(plugin, current.handle, { name, email: email || null });
            ui.toast(`Updated Assignee ${current.handle}`);
          } else {
            const added = await addAssignee(plugin, { handle: String(values.handle), name, email });
            ui.toast(`Added Assignee ${added.handle}`);
          }
          ui.back();
        }}
      />
    </Box>
  );
}
