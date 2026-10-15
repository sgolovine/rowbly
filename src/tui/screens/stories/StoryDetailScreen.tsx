import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { pluginStoryRows } from '../../../services';
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
import { StoryTasksTab } from '../tasks';
import type { ScreenProps } from '../types';

const TABS = ['Details', 'Tasks'] as const;
type Mode = 'view' | 'move' | 'confirm-delete';

/**
 * One Story (`params.key`) with tabs Details | Tasks, then the tabs Plugins add; `e`
 * edits, `m` moves, `d` deletes.
 */
export function StoryDetailScreen({ params }: ScreenProps) {
  const services = useServices();
  const ctx = useRowblyContext();
  const toast = useToast();
  const router = useRouter();
  const active = useIsActive();
  const { plugins } = usePlugins();
  const key = String(params.key ?? '');
  const [tab, setTab] = useState(0);
  const [mode, setMode] = useState<Mode>('view');
  const data = useAsync(async () => {
    const story = await services.stories.get(key);
    const config = await services.config.effective(story.boardId);
    const extraRows = ctx ? await pluginStoryRows(ctx, services, story) : [];
    return { story, config, extraRows };
  }, [services, ctx, key]);
  useReloadOnReturn(data.reload);
  useActionFocus({ story: data.data?.story });
  const viewing = mode === 'view';
  const pluginTabs = plugins.flatMap((p) => (p.tui.storyTabs ?? []).map((t) => ({ plugin: p.id, ...t })));
  const tabs = [...TABS, ...pluginTabs.map((t) => t.label)];

  useKeyCapture(active && mode === 'move', { escape: true });
  useEscape(active && mode === 'move', () => setMode('view'));
  useKeyHints(
    !viewing
      ? [{ key: 'esc', description: 'cancel' }]
      : tab === 0
        ? [
            { key: 'tab/←/→', description: 'switch tab' },
            { key: 'e', description: 'edit' },
            { key: 'm', description: 'move Stage' },
            { key: 'd', description: 'delete' },
          ]
        : [{ key: 'tab/←/→', description: 'switch tab' }],
  );

  useInput(
    (input, key) => {
      const story = data.data?.story;
      if (!story) return;
      if (key.tab || key.rightArrow) setTab((t) => (t + 1) % tabs.length);
      else if (key.leftArrow) setTab((t) => (t + tabs.length - 1) % tabs.length);
      // The Tasks and Plugin tabs handle their own keys.
      else if (tab !== 0) return;
      else if (input === 'e') router.push('story-form', { key: story.key, title: `Edit ${story.key}` });
      else if (input === 'm') setMode('move');
      else if (input === 'd') setMode('confirm-delete');
    },
    { isActive: active && viewing },
  );

  if (!data.data) return data.loading ? <Loading label={`Loading ${key}…`} /> : <Text color="red">No Story.</Text>;
  const { story, config, extraRows } = data.data;

  const move = async (stage: string) => {
    try {
      await services.stories.move(story.key, stage);
      toast.push('info', `Moved ${story.key} to ${stage}`);
      data.reload();
    } catch (err) {
      toast.error(err);
    }
    setMode('view');
  };

  const remove = async () => {
    try {
      await services.stories.remove(story.key);
      toast.push('info', `Deleted ${story.key}`);
      router.pop();
    } catch (err) {
      toast.error(err);
      setMode('view');
    }
  };

  const none = <Text dimColor>—</Text>;
  const rows: DetailRow[] = [
    { label: 'Stage', value: <StoryStage stages={config.stages} story={story} /> },
    { label: 'Priority', value: story.priority ?? none },
    { label: 'Assignees', value: story.assignees.join(', ') || none },
    { label: 'Labels', value: story.labels.join(', ') || none },
    { label: 'Due', value: story.dueDate ?? none },
    ...extraRows,
    ...Object.entries(story.customFields).map(([field, value]) => ({
      label: config.customFields.find((f) => f.key === field)?.name ?? field,
      value: Array.isArray(value) ? value.join(', ') : String(value),
    })),
    { label: 'Created', value: `${story.createdAt}${story.createdBy ? ` by ${story.createdBy}` : ''}` },
    { label: 'Updated', value: story.updatedAt },
  ];

  return (
    <Box flexDirection="column" gap={1}>
      <Text>
        <Text bold color="cyan">
          {story.key}
        </Text>{' '}
        <Text bold>{story.name}</Text>
      </Text>
      <Tabs tabs={tabs} selected={tab} onSelect={setTab} active={active && viewing} />
      {tab === 0 && <DetailView rows={rows} body={story.description} />}
      {tab === 1 && <StoryTasksTab storyKey={story.key} />}
      {pluginTabs.map(
        ({ plugin, label, component: PluginTab }, i) =>
          tab === TABS.length + i && (
            <PluginSlot
              key={`${plugin}:${label}`}
              plugin={plugin}
              render={(context, ui) => <PluginTab story={story} active={active && viewing} plugin={context} ui={ui} />}
            />
          ),
      )}
      {mode === 'move' && (
        <Box flexDirection="column">
          <Text bold>Move {story.key} to</Text>
          <SelectList
            items={config.stages.map((s) => ({
              value: s.key,
              label: s.name,
              description: s.key === story.stage ? `${s.key} (current)` : s.key,
            }))}
            onSelect={(item) => void move(item.value)}
          />
        </Box>
      )}
      {mode === 'confirm-delete' && (
        <ConfirmDialog
          message={`Delete ${story.key} "${story.name}" with its Tasks?`}
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
