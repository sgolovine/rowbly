import { Box, Text } from 'ink';
import { Form, type FormField, Loading } from '../../components';
import { useAsync, useServices, useToast } from '../../hooks';
import { useRouter } from '../../router';

const CREATE_FIELDS: FormField[] = [
  { name: 'id', label: 'Id', kind: 'text', required: true },
  { name: 'name', label: 'Name', kind: 'text', required: true },
  { name: 'description', label: 'Description', kind: 'multiline' },
];
const EDIT_FIELDS = CREATE_FIELDS.slice(1);

/** Creates an Epic, or edits Epic `id` when given. */
export function EpicForm({ id }: { id?: string }) {
  const services = useServices();
  const router = useRouter();
  const toast = useToast();
  const loaded = useAsync(async () => ({ epic: id ? await services.epics.get(id) : null }), [services, id]);

  if (!loaded.data) return loaded.loading ? <Loading /> : null;
  const { epic } = loaded.data;
  return (
    <Box flexDirection="column">
      <Text bold>{epic ? `Edit Epic ${epic.id}` : 'New Epic'}</Text>
      <Form
        fields={epic ? EDIT_FIELDS : CREATE_FIELDS}
        initialValues={epic ? { name: epic.name, description: epic.description } : {}}
        onSubmit={async (values) => {
          const name = String(values.name);
          const description = String(values.description ?? '');
          if (epic) {
            await services.epics.update(epic.id, { name, description });
            toast.push('info', `Updated Epic ${epic.id}`);
            router.pop();
          } else {
            const created = await services.epics.create({ id: String(values.id), name, description });
            toast.push('info', `Created Epic ${created.id}`);
            router.replace('epics', { view: 'detail', id: created.id, title: created.name });
          }
        }}
      />
    </Box>
  );
}
