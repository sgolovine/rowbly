import type { PluginScreenProps } from '../../plugin-api';
import {
  Box,
  ConfirmDialog,
  type DetailRow,
  DetailView,
  Loading,
  SelectList,
  Text,
  useAsync,
  useInput,
  useIsActive,
  useKeyCapture,
  useKeyHints,
  useReloadOnReturn,
  useState,
} from '../../plugin-api/tui';
import { TaskStage } from './TaskStage';
import { deleteTask, getTask, moveTask, stagesOf } from './tasks';

type Mode = 'view' | 'move' | 'confirm-delete';

/**
 * One Task (`params.id`): `e` edits, `m` moves it to a Stage and `d` deletes it.
 */
export function TaskScreen({ params, plugin, ui }: PluginScreenProps<Record<string, unknown>>) {
  const active = useIsActive();
  const id = typeof params.id === 'string' ? params.id : '';
  const [mode, setMode] = useState<Mode>('view');
  const [busy, setBusy] = useState(false);
  const data = useAsync(async () => {
    const { story, task } = await getTask(plugin, id);
    return { story, task, stages: await stagesOf(plugin, story) };
  }, [plugin, id]);
  useReloadOnReturn(data.reload);
  const viewing = active && mode === 'view' && !busy;

  useKeyHints(
    !active
      ? []
      : mode === 'move'
        ? [{ key: 'esc', description: 'cancel' }]
        : [
            { key: 'e', description: 'edit' },
            { key: 'm', description: 'move Stage' },
            { key: 'd', description: 'delete' },
          ],
  );
  useKeyCapture(active && mode === 'move', { escape: true });
  useInput((_input, key) => key.escape && setMode('view'), { isActive: active && mode === 'move' });

  useInput(
    (input) => {
      const task = data.data?.task;
      if (!task) return;
      if (input === 'e') ui.open('form', { id: task.id, title: `Edit ${task.id}` });
      else if (input === 'm') setMode('move');
      else if (input === 'd') setMode('confirm-delete');
    },
    { isActive: viewing && data.data !== undefined },
  );

  if (!data.data) {
    if (data.loading) return <Loading label={`Loading ${id}…`} />;
    const reason = data.error instanceof Error ? data.error.message : 'No Task.';
    return <Text color="red">{reason}</Text>;
  }
  const { story, task, stages } = data.data;

  const move = async (stage: string) => {
    setBusy(true);
    try {
      await moveTask(plugin, task.id, stage);
      ui.toast(`Moved ${task.id} to ${stage}`);
      data.reload();
    } catch (err) {
      ui.error(err);
    } finally {
      setBusy(false);
      setMode('view');
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deleteTask(plugin, task.id);
      ui.toast(`Deleted ${task.id}`);
      ui.back();
    } catch (err) {
      ui.error(err);
      setBusy(false);
      setMode('view');
    }
  };

  const rows: DetailRow[] = [
    { label: 'Story', value: `${story.key} ${story.name}` },
    { label: 'Stage', value: <TaskStage stages={stages} stage={task.stage} /> },
    { label: 'Created', value: task.createdAt },
    { label: 'Updated', value: task.updatedAt },
  ];

  return (
    <Box flexDirection="column" gap={1}>
      <Text>
        <Text bold color="cyan">
          {task.id}
        </Text>{' '}
        <Text bold>{task.name}</Text>
      </Text>
      <DetailView rows={rows} body={task.description} />
      {mode === 'move' && (
        <Box flexDirection="column">
          <Text bold>Move {task.id} to</Text>
          <SelectList
            items={stages.map((s) => ({
              value: s.key,
              label: s.name,
              description: s.key === task.stage ? `${s.key} (current)` : s.key,
            }))}
            onSelect={(item) => void move(item.value)}
          />
        </Box>
      )}
      {mode === 'confirm-delete' && (
        <ConfirmDialog
          message={`Delete ${task.id} "${task.name}"?`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          destructive
          isActive={active && !busy}
          onConfirm={() => void remove()}
          onCancel={() => setMode('view')}
        />
      )}
    </Box>
  );
}
