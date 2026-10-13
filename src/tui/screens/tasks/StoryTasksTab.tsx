import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { ConfirmDialog, Loading, SelectList } from '../../components';
import { useAsync, useIsActive, useKeyCapture, useServices, useToast } from '../../hooks';
import { useRouter } from '../../router';
import { CursorRows, useCursor, useEscape } from '../stages/shared';
import { StoryStage, useReloadOnReturn } from '../stories/shared';

export interface StoryTasksTabProps {
  storyKey: string;
}

type Mode = 'view' | 'move' | 'confirm-delete';

/** The Tasks of a Story in creation order: `n` new, `enter` open, `m` move Stage, `e` edit, `d` delete. */
export function StoryTasksTab({ storyKey }: StoryTasksTabProps) {
  const services = useServices();
  const toast = useToast();
  const router = useRouter();
  const active = useIsActive();
  const [mode, setMode] = useState<Mode>('view');
  const data = useAsync(async () => {
    const story = await services.stories.get(storyKey);
    const config = await services.config.effective(story.boardId);
    return { tasks: story.tasks, stages: config.stages };
  }, [services, storyKey]);
  useReloadOnReturn(data.reload);
  const tasks = data.data?.tasks ?? [];
  const viewing = active && mode === 'view';
  const [cursor] = useCursor(tasks.length, viewing);
  const task = tasks[cursor];

  useKeyCapture(active && mode === 'move', { escape: true });
  useEscape(active && mode === 'move', () => setMode('view'));

  useInput(
    (input, key) => {
      if (input === 'n') router.push('task-form', { storyKey, title: `New Task on ${storyKey}` });
      if (!task) return;
      if (key.return) router.push('task', { id: task.id, title: task.id });
      else if (input === 'e') router.push('task-form', { id: task.id, title: `Edit ${task.id}` });
      else if (input === 'm') setMode('move');
      else if (input === 'd') setMode('confirm-delete');
    },
    { isActive: viewing && data.data !== undefined },
  );

  if (!data.data) return data.loading ? <Loading label="Loading Tasks…" /> : <Text color="red">No Tasks.</Text>;
  const { stages } = data.data;

  const run = async (action: () => Promise<unknown>, message: string) => {
    try {
      await action();
      toast.push('info', message);
      data.reload();
    } catch (err) {
      toast.error(err);
    }
    setMode('view');
  };

  return (
    <Box flexDirection="column" gap={1}>
      {tasks.length === 0 ? (
        <Text dimColor>No Tasks yet. Press n to create one.</Text>
      ) : (
        <CursorRows
          cursor={cursor}
          active={viewing}
          rows={tasks.map((t) => (
            <Text key={t.id}>
              <Text color="cyan">{t.id}</Text> {t.name} <StoryStage stages={stages} story={t} />
              {t.comments.length > 0 && <Text dimColor> · {plural(t.comments.length, 'Comment')}</Text>}
            </Text>
          ))}
        />
      )}
      <Text dimColor>n new · enter open · m move Stage · e edit · d delete</Text>
      {mode === 'move' && task && (
        <Box flexDirection="column">
          <Text bold>Move {task.id} to</Text>
          <SelectList
            items={stages.map((s) => ({
              value: s.key,
              label: s.name,
              description: s.key === task.stage ? `${s.key} (current)` : s.key,
            }))}
            onSelect={(item) =>
              void run(() => services.tasks.move(task.id, item.value), `Moved ${task.id} to ${item.value}`)
            }
          />
        </Box>
      )}
      {mode === 'confirm-delete' && task && (
        <ConfirmDialog
          message={`Delete ${task.id} "${task.name}" with its Comments?`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => void run(() => services.tasks.remove(task.id), `Deleted ${task.id}`)}
          onCancel={() => setMode('view')}
        />
      )}
    </Box>
  );
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}
