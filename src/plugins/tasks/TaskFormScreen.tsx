import { type PluginScreenProps, UsageError } from '../../plugin-api';
import { Box, Form, type FormValues, Loading, Text, theme, useAsync } from '../../plugin-api/tui';
import { createTask, getTask, stagesOf, updateTask } from './tasks';

/** Creates a Task in a Story (`params.storyKey`) or edits one (`params.id`), including its Stage. */
export function TaskFormScreen({ params, plugin, ui }: PluginScreenProps<Record<string, unknown>>) {
  // Malformed params fail the load, so a bad route never creates or edits by accident.
  const data = useAsync(async () => {
    const { storyKey, id } = formParams(params);
    const found = id === undefined ? null : await getTask(plugin, id);
    const story = found?.story ?? (await plugin.services.stories.get(storyKey ?? ''));
    const stages = (await stagesOf(plugin, story)).map((s) => s.key);
    return { story, task: found?.task ?? null, stages };
  }, [plugin, params.storyKey, params.id]);

  if (data.loading) return <Loading label="Loading…" />;
  if (!data.data) {
    const reason = data.error instanceof Error ? data.error.message : String(data.error);
    return <Text color={theme.danger}>Could not open the Task form: {reason}</Text>;
  }
  const { story, task, stages } = data.data;

  const submit = async (values: FormValues) => {
    const input = { name: String(values.name), description: String(values.description ?? '') };
    const stage = String(values.stage);
    if (!task) {
      const created = await createTask(plugin, story.key, { ...input, stage });
      ui.toast(`Created ${created.id}`);
    } else {
      // One operation, so a rejected Stage change saves none of the edit (ARCH-43).
      await updateTask(plugin, task.id, { ...input, stage });
      ui.toast(`Updated ${task.id}`);
    }
    ui.back();
  };

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>{task ? `Edit ${task.id}` : `New Task on ${story.key}`}</Text>
      <Form
        fields={[
          { name: 'name', label: 'Name', kind: 'text', required: true },
          { name: 'description', label: 'Description', kind: 'multiline' },
          { name: 'stage', label: 'Stage', kind: 'select', required: true, options: stages },
        ]}
        initialValues={{
          name: task?.name ?? '',
          description: task?.description ?? '',
          stage: task?.stage ?? stages[0] ?? null,
        }}
        onSubmit={submit}
      />
    </Box>
  );
}

/** A Task `id` to edit, or a `storyKey` to create a Task in; anything else is a `UsageError`. */
function formParams(params: Record<string, unknown>): { storyKey?: string; id?: string } {
  const { storyKey, id } = params;
  if (typeof id === 'string' && id !== '') return { id };
  if (typeof storyKey === 'string' && storyKey !== '') return { storyKey };
  throw new UsageError('the Task form needs a Task id or a Story Key');
}
