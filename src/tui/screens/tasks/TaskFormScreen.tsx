import { Box, Text } from 'ink';
import { Form, type FormValues, Loading } from '../../components';
import { useAsync, useKeyHints, useServices, useToast } from '../../hooks';
import { FORM_KEYS } from '../../keymap';
import { useRouter } from '../../router';
import type { ScreenProps } from '../types';

/** Creates a Task in a Story (`params.storyKey`) or edits one (`params.id`), including its Stage. */
export function TaskFormScreen({ params }: ScreenProps) {
  const services = useServices();
  const toast = useToast();
  const router = useRouter();
  const id = params.id as string | undefined;
  const data = useAsync(async () => {
    const found = id ? await services.tasks.get(id) : null;
    const story = found?.story ?? (await services.stories.get(String(params.storyKey ?? '')));
    const config = await services.config.effective(story.boardId);
    return { story, task: found?.task ?? null, stages: config.stages.map((s) => s.key) };
  }, [services, id, params.storyKey]);
  useKeyHints(FORM_KEYS);

  if (!data.data) return data.loading ? <Loading label="Loading…" /> : <Text color="red">Cannot open the form.</Text>;
  const { story, task, stages } = data.data;

  const submit = async (values: FormValues) => {
    const input = { name: String(values.name), description: String(values.description ?? '') };
    const stage = String(values.stage);
    if (!task) {
      const created = await services.tasks.create(story.key, { ...input, stage });
      toast.push('info', `Created ${created.id}`);
    } else {
      await services.tasks.update(task.id, input);
      if (stage !== task.stage) await services.tasks.move(task.id, stage);
      toast.push('info', `Updated ${task.id}`);
    }
    router.pop();
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
