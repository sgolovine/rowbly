import type { PluginStoryTabProps } from '../../plugin-api';
import {
  Box,
  ConfirmDialog,
  Loading,
  Modal,
  moveDelta,
  SelectionRow,
  SelectList,
  Text,
  theme,
  useAsync,
  useInput,
  useIsActive,
  useKeyCapture,
  useKeyHints,
  useReloadOnReturn,
  useState,
} from '../../plugin-api/tui';
import { TaskStage } from './TaskStage';
import { deleteTask, moveTask, stagesOf, storedTasks } from './tasks';

type Mode = 'view' | 'move' | 'confirm-delete';

/** The Tasks of a Story in creation order: `n` new, `enter` open, `m` move Stage, `e` edit, `d` delete. */
export function TasksTab({ story, active, plugin, ui }: PluginStoryTabProps<Record<string, unknown>>) {
  const isActive = useIsActive() && active;
  const [mode, setMode] = useState<Mode>('view');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(0);
  // `tasks: null` is a stored bag that is invalid: it is shown as unavailable, never as empty.
  const data = useAsync(async () => {
    const current = await plugin.services.stories.get(story.key);
    return { tasks: storedTasks(plugin, current), stages: await stagesOf(plugin, current) };
  }, [plugin, story.key]);
  // Reloads the Tasks when the Task screen or form closes.
  useReloadOnReturn(data.reload, isActive);
  const tasks = data.data?.tasks ?? [];
  const viewing = isActive && mode === 'view' && !busy && Boolean(data.data?.tasks);
  const cursor = Math.max(0, Math.min(selected, tasks.length - 1));
  const task = tasks[cursor];

  useKeyHints(
    viewing
      ? [
          { key: 'tab/←/→', description: 'switch tab' },
          { key: 'n', description: 'new Task' },
          ...(task
            ? [
                { key: 'enter', description: 'open Task' },
                { key: 'm', description: 'move Task' },
                { key: 'e', description: 'edit Task' },
                { key: 'd', description: 'delete Task' },
              ]
            : []),
        ]
      : isActive && mode === 'move'
        ? [{ key: 'esc', description: 'cancel' }]
        : [],
  );
  useKeyCapture(isActive && mode === 'move', { escape: true });
  useInput((_input, key) => key.escape && setMode('view'), { isActive: isActive && mode === 'move' });

  useInput(
    (input, key) => {
      const delta = moveDelta(input, key);
      if (delta) setSelected(Math.max(0, Math.min(tasks.length - 1, cursor + delta)));
      else if (input === 'n') ui.open('form', { storyKey: story.key, title: `New Task on ${story.key}` });
      else if (!task) return;
      else if (key.return) ui.open('task', { id: task.id, title: task.id });
      else if (input === 'e') ui.open('form', { id: task.id, title: `Edit ${task.id}` });
      else if (input === 'm') setMode('move');
      else if (input === 'd') setMode('confirm-delete');
    },
    { isActive: viewing },
  );

  if (data.data?.tasks === null) {
    return <Text color={theme.danger}>Tasks unavailable: the stored Tasks are invalid; run `rowbly doctor`.</Text>;
  }
  if (!data.data) {
    return data.loading ? <Loading label="Loading Tasks…" /> : <Text color={theme.danger}>Could not load Tasks.</Text>;
  }
  const { stages } = data.data;

  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await action();
      ui.toast(message);
      data.reload();
    } catch (err) {
      ui.error(err);
    } finally {
      setBusy(false);
      setMode('view');
    }
  };

  return (
    <Box flexDirection="column" gap={1}>
      {tasks.length === 0 ? (
        <Text color={theme.inkFaint}>No Tasks yet. Press n to create one.</Text>
      ) : (
        <Box flexDirection="column">
          {tasks.map((t, i) => (
            <SelectionRow key={t.id} selected={i === cursor} active={viewing} onClick={() => setSelected(i)}>
              <Text>
                <Text color={theme.accent}>{t.id}</Text> {t.name} <TaskStage stages={stages} stage={t.stage} />
              </Text>
            </SelectionRow>
          ))}
        </Box>
      )}
      {mode === 'move' && task && (
        <Modal title={`${task.id} › Move Stage`} onClose={() => setMode('view')}>
          <SelectList
            items={stages.map((s) => ({
              value: s.key,
              label: s.name,
              description: s.key === task.stage ? `${s.key} (current)` : s.key,
            }))}
            onSelect={(item) =>
              void run(() => moveTask(plugin, task.id, item.value), `Moved ${task.id} to ${item.value}`)
            }
          />
        </Modal>
      )}
      {mode === 'confirm-delete' && task && (
        <Modal title="Delete" onClose={() => setMode('view')}>
          <ConfirmDialog
            message={`Delete ${task.id} "${task.name}"?`}
            confirmLabel="Delete"
            cancelLabel="Cancel"
            destructive
            isActive={isActive && !busy}
            onConfirm={() => void run(() => deleteTask(plugin, task.id), `Deleted ${task.id}`)}
            onCancel={() => setMode('view')}
          />
        </Modal>
      )}
    </Box>
  );
}
