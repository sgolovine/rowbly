import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { pluginTaskRows } from '../../../services';
import {
  ConfirmDialog,
  type DetailRow,
  DetailView,
  Loading,
  PluginSlot,
  SelectList,
  StoryStage,
  Tabs,
} from '../../components';
import {
  useActionFocus,
  useAsync,
  useEscape,
  useIsActive,
  useKeyCapture,
  useKeyHints,
  usePlugins,
  useReloadOnReturn,
  useRowblyContext,
  useServices,
  useToast,
} from '../../hooks';
import { useRouter } from '../../router';
import type { ScreenProps } from '../types';

const TABS = ['Details'] as const;
type Mode = 'view' | 'move' | 'confirm-delete';

/**
 * One Task (`params.id`) with tab Details, then the tabs Plugins add; on Details `e` edits, `m` moves
 * it to a Stage and `d` deletes it. Tasks have no Assignees of their own: the Story's are shown.
 */
export function TaskDetailScreen({ params }: ScreenProps) {
  const services = useServices();
  const ctx = useRowblyContext();
  const toast = useToast();
  const router = useRouter();
  const active = useIsActive();
  const { plugins } = usePlugins();
  const id = String(params.id ?? '');
  const [tab, setTab] = useState(0);
  const [mode, setMode] = useState<Mode>('view');
  const data = useAsync(async () => {
    const { story, task } = await services.tasks.get(id);
    const config = await services.config.effective(story.boardId);
    const extraRows = ctx ? await pluginTaskRows(ctx, services, task, story) : [];
    return { story, task, stages: config.stages, extraRows };
  }, [services, ctx, id]);
  useReloadOnReturn(data.reload);
  useActionFocus({ story: data.data?.story, task: data.data?.task });
  const viewing = mode === 'view';
  // A tab's ID is its Plugin and its place in that Plugin's list, never its label (ARCH-40).
  const pluginTabs = plugins.flatMap((p) =>
    (p.tui.taskTabs ?? []).map((t, i) => ({ id: `${p.id}:${i}`, plugin: p.id, ...t })),
  );
  const tabs = [...TABS, ...pluginTabs.map((t) => t.label)];

  useKeyCapture(active && mode === 'move', { escape: true });
  useEscape(active && mode === 'move', () => setMode('view'));
  useKeyHints(
    !viewing
      ? [{ key: 'esc', description: 'cancel' }]
      : tab === 0
        ? [
            ...(tabs.length > 1 ? [{ key: 'tab/←/→', description: 'switch tab' }] : []),
            { key: 'e', description: 'edit' },
            { key: 'm', description: 'move Stage' },
            { key: 'd', description: 'delete' },
          ]
        : [{ key: 'tab/←/→', description: 'switch tab' }],
  );

  useInput(
    (input, key) => {
      const task = data.data?.task;
      if (!task) return;
      if (key.tab || key.rightArrow) setTab((t) => (t + 1) % tabs.length);
      else if (key.leftArrow) setTab((t) => (t + tabs.length - 1) % tabs.length);
      // Plugin tabs handle their own keys.
      else if (tab !== 0) return;
      else if (input === 'e') router.push('task-form', { id: task.id, title: `Edit ${task.id}` });
      else if (input === 'm') setMode('move');
      else if (input === 'd') setMode('confirm-delete');
    },
    { isActive: active && viewing },
  );

  if (!data.data) return data.loading ? <Loading label={`Loading ${id}…`} /> : <Text color="red">No Task.</Text>;
  const { story, task, stages, extraRows } = data.data;

  const move = async (stage: string) => {
    try {
      await services.tasks.move(task.id, stage);
      toast.push('info', `Moved ${task.id} to ${stage}`);
      data.reload();
    } catch (err) {
      toast.error(err);
    }
    setMode('view');
  };

  const remove = async () => {
    try {
      await services.tasks.remove(task.id);
      toast.push('info', `Deleted ${task.id}`);
      router.pop();
    } catch (err) {
      toast.error(err);
      setMode('view');
    }
  };

  const rows: DetailRow[] = [
    { label: 'Story', value: `${story.key} ${story.name}` },
    { label: 'Stage', value: <StoryStage stages={stages} story={task} /> },
    {
      label: 'Assignees',
      value: story.assignees.length ? (
        <Text>
          {story.assignees.join(', ')} <Text dimColor>(from the Story)</Text>
        </Text>
      ) : (
        <Text dimColor>—</Text>
      ),
    },
    ...extraRows,
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
      {tabs.length > 1 && <Tabs tabs={tabs} selected={tab} onSelect={setTab} active={active && viewing} />}
      {tab === 0 && <DetailView rows={rows} body={task.description} />}
      {pluginTabs.map(
        ({ id, plugin, component: PluginTab }, i) =>
          tab === TABS.length + i && (
            <PluginSlot
              key={id}
              pluginId={plugin}
              render={(context, ui) => (
                <PluginTab story={story} task={task} active={active && viewing} plugin={context} ui={ui} />
              )}
            />
          ),
      )}
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
          onConfirm={() => void remove()}
          onCancel={() => setMode('view')}
        />
      )}
    </Box>
  );
}
