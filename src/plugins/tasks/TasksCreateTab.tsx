import type { PluginStoryCreateTabProps } from '../../plugin-api';
import {
  Box,
  Form,
  type FormValues,
  Loading,
  SelectList,
  Text,
  useAsync,
  useInput,
  useKeyHints,
  useState,
} from '../../plugin-api/tui';
import type { TaskCreateInput } from './model';

/** Task drafts never call tasks.create: the host submits them with the Story. */
export function TasksCreateTab({ draft, onChange, boardId, active, plugin }: PluginStoryCreateTabProps) {
  const tasks = (draft ?? []) as TaskCreateInput[];
  const [editing, setEditing] = useState<number | null>(null);
  const [selected, setSelected] = useState(0);
  const data = useAsync(() => plugin.services.config.effective(boardId), [plugin, boardId]);
  useKeyHints(
    active && editing === null
      ? [
          { key: 'n', description: 'new Task' },
          { key: 'enter', description: 'edit Task' },
          { key: 'd', description: 'remove draft' },
        ]
      : [],
  );
  useInput(
    (input) => {
      if (input === 'n' && data.data) {
        onChange([...tasks, { name: '', description: '', stage: data.data.stages[0]?.key }]);
        setEditing(tasks.length);
      } else if (input === 'd') onChange(tasks.filter((_, i) => i !== selected));
    },
    { isActive: active && editing === null },
  );
  if (data.error) throw data.error;
  if (!data.data) return <Loading />;
  const task = editing === null ? undefined : tasks[editing];
  const change = (values: FormValues) =>
    onChange(
      tasks.map((t, i) =>
        i === editing
          ? {
              name: String(values.name ?? ''),
              description: String(values.description ?? ''),
              stage: String(values.stage),
            }
          : t,
      ),
    );
  return (
    <Box flexDirection="column" gap={1}>
      <Text>{tasks.length} Task drafts</Text>
      {task ? (
        <Form
          key={editing}
          fields={[
            { name: 'name', label: 'Name', kind: 'text', required: true },
            { name: 'description', label: 'Description', kind: 'multiline' },
            {
              name: 'stage',
              label: 'Stage',
              kind: 'select',
              required: true,
              options: data.data.stages.map((s) => s.key),
            },
          ]}
          initialValues={{ name: task.name, description: task.description ?? '', stage: task.stage ?? null }}
          values={{ name: task.name, description: task.description ?? '', stage: task.stage ?? null }}
          onChange={change}
          onSubmit={() => setEditing(null)}
          isActive={active}
          submitLabel="keep draft"
        />
      ) : (
        <SelectList
          items={tasks.map((t, i) => ({ value: i, label: `${i + 1}. ${t.name || '(unnamed Task)'} · ${t.stage}` }))}
          onHighlight={(item) => setSelected(item?.value ?? 0)}
          onSelect={(item) => setEditing(item.value)}
          isActive={active}
          emptyText="No Task drafts. Press n for a new Task."
        />
      )}
    </Box>
  );
}
