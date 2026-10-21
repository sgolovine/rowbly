import type { PluginScreenProps } from '../../plugin-api';
import { Form, Loading, Text, theme, useAsync, useKeyHints } from '../../plugin-api/tui';
import { createEpic, editEpic, getEpic } from './service';

export function EpicForm({ params, plugin, ui }: PluginScreenProps<Record<string, unknown>>) {
  const id = typeof params.id === 'string' ? params.id : undefined;
  const data = useAsync(async () => (id ? getEpic(plugin, id) : null), [plugin, id]);
  useKeyHints([
    { key: 'ctrl+s', description: 'save' },
    { key: 'esc', description: 'cancel' },
  ]);
  if (data.data === undefined)
    return data.loading ? <Loading label="Loading Epic…" /> : <Text color={theme.danger}>Could not load Epic.</Text>;
  return (
    <Form
      fields={[
        ...(!id ? [{ name: 'id', label: 'Epic', kind: 'text' as const, required: true }] : []),
        { name: 'name', label: 'Name', kind: 'text', required: true },
        { name: 'description', label: 'Description', kind: 'multiline' },
      ]}
      initialValues={{ id: id ?? '', name: data.data?.name ?? '', description: data.data?.description ?? '' }}
      onSubmit={async (values) => {
        const input = { name: String(values.name), description: String(values.description) };
        const epic = id
          ? await editEpic(plugin, id, input)
          : await createEpic(plugin, { id: String(values.id), ...input });
        ui.toast(`${id ? 'Updated' : 'Created'} Epic ${epic.id}`);
        ui.back();
      }}
    />
  );
}
