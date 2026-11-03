import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { pluginStoryRows, type RowblyContext } from '../../../services';
import { storyWithConfig } from '../../../services/stories';
import {
  ConfirmDialog,
  type DetailRow,
  DetailView,
  Loading,
  Modal,
  PluginSlot,
  ScrollBody,
  SelectList,
  StageBadge,
  StoryStage,
  Tabs,
  useCovered,
} from '../../components';
import {
  loadStoryBadges,
  useActionFocus,
  useAsync,
  useEscape,
  useIsActive,
  useKeyCapture,
  useKeyHints,
  useLayout,
  usePlugins,
  useReloadOnReturn,
  useRowblyContext,
  useServices,
  useStoryPaste,
  useToast,
} from '../../hooks';
import { useRouter } from '../../router';
import { formatDate, relativeDate, theme } from '../../theme';
import type { ScreenProps } from '../types';

const TABS = ['Details'] as const;
type Mode = 'view' | 'move' | 'confirm-delete';

/**
 * One Story (`params.key`) with tab Details, then the tabs Plugins add; `e` edits, `m` moves, `d`
 * deletes.
 */
export function StoryDetailScreen({ params }: ScreenProps) {
  const services = useServices();
  const ctx = useRowblyContext();
  const toast = useToast();
  const router = useRouter();
  const active = useIsActive();
  // A task open over the Story, its own or a tab's, takes the keys; the Story takes none until it closes.
  const covered = useCovered();
  const layout = useLayout();
  const { plugins } = usePlugins();
  const key = String(params.key ?? '');
  const [tab, setTab] = useState(0);
  const [mode, setMode] = useState<Mode>('view');
  // The Story and its Stages first, so that it shows and takes its keys at once (ADR-0052 §3).
  const data = useAsync(
    async () =>
      ctx
        ? storyWithConfig(ctx, services, key)
        : services.stories
            .get(key)
            .then(async (story) => ({ story, config: await services.config.effective(story.boardId) })),
    [services, ctx, key],
  );
  useReloadOnReturn(data.reload);
  // Then what Plugins add, outside the Data Root lock: every reload of the Story loads it again, and a
  // load for an earlier Story is dropped when it settles. Until it comes, the last one shows.
  const loaded = data.data?.story;
  const enrichment = useAsync(async () => {
    if (!loaded) return null;
    const [extraRows, badges] = await Promise.all([
      ctx ? pluginStoryRows(ctx, services, loaded) : [],
      loadStoryBadges(plugins, services),
    ]);
    return { extraRows, badges: badges(loaded) };
  }, [services, ctx, loaded, plugins]);
  const rowsPending = enrichment.loading && !enrichment.data && pluginRowsExpected(ctx);
  useActionFocus({ story: data.data?.story });
  const paste = useStoryPaste({
    boardId: data.data?.story.boardId,
    story: data.data?.story,
    enabled: mode === 'view',
    onSaved: data.reload,
  });
  const viewing = mode === 'view';
  // A tab's ID is its Plugin and its place in that Plugin's list, never its label (ARCH-40).
  const pluginTabs = plugins.flatMap((p) =>
    (p.tui.storyTabs ?? []).map((t, i) => ({ id: `${p.id}:${i}`, plugin: p.id, ...t })),
  );
  const tabs = [...TABS, ...pluginTabs.map((t) => t.label)];

  useKeyCapture(active && mode === 'move', { escape: true });
  useEscape(active && mode === 'move', () => setMode('view'));
  useKeyHints(
    !viewing
      ? []
      : tab === 0
        ? [
            { key: 'tab/←/→', description: 'switch tab' },
            { key: 'e', description: 'edit' },
            ...paste.hints,
            { key: 'm', description: 'move Stage' },
            { key: 'd', description: 'delete' },
          ]
        : [{ key: 'tab/←/→', description: 'switch tab' }, ...paste.hints],
  );

  useInput(
    (input, key) => {
      const story = data.data?.story;
      if (!story) return;
      if (key.tab || key.rightArrow) setTab((t) => (t + 1) % tabs.length);
      else if (key.leftArrow) setTab((t) => (t + tabs.length - 1) % tabs.length);
      // Plugin tabs handle their own keys.
      else if (tab !== 0) return;
      else if (input === 'e') router.push('story-form', { key: story.key, title: `Edit ${story.key}` });
      else if (input === 'm') setMode('move');
      else if (input === 'd') setMode('confirm-delete');
    },
    { isActive: active && viewing && !covered },
  );

  if (!data.data)
    return data.loading ? <Loading label={`Loading ${key}…`} /> : <Text color={theme.danger}>No Story.</Text>;
  const { story, config } = data.data;
  const extraRows = enrichment.data?.extraRows ?? [];
  const badges = enrichment.data?.badges ?? [];

  const move = async (stage: string) => {
    try {
      await services.stories.move(story.key, stage);
      toast.push('info', `Moved ${story.key} to ${config.stages.find((s) => s.key === stage)?.name ?? stage}`);
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

  const none = <Text color={theme.inkFaint}>—</Text>;
  const rows: DetailRow[] = [
    { label: 'Stage', value: <StoryStage stages={config.stages} story={story} /> },
    { label: 'Priority', value: story.priority ?? none },
    { label: 'Labels', value: story.labels.join(', ') || none },
    { label: 'Due', value: story.dueDate ?? none },
    ...(rowsPending ? [{ label: 'Plugins', value: <Loading /> }] : extraRows),
    ...Object.entries(story.customFields).map(([field, value]) => ({
      label: config.customFields.find((f) => f.key === field)?.name ?? field,
      value: Array.isArray(value) ? value.join(', ') : String(value),
    })),
    { label: 'Created', value: `${formatDate(story.createdAt)}${story.createdBy ? ` by ${story.createdBy}` : ''}` },
    { label: 'Updated', value: formatDate(story.updatedAt) },
  ];

  return (
    <Box flexDirection="column" flexGrow={1} height={layout.height}>
      <Box backgroundColor={theme.overlayRaised} flexDirection="column" flexShrink={0} paddingX={1} marginBottom={1}>
        <Text wrap="truncate-end">
          <Text color={theme.accent}>{story.key}</Text>{' '}
          <Text bold color={theme.ink}>
            {story.name}
          </Text>
        </Text>
        <Text wrap="truncate-end">
          <StageBadge
            stage={
              config.stages.find((stage) => stage.key === story.stage) ?? { name: story.stage, category: 'backlog' }
            }
          />
          {story.priority && <Text color={theme.inkMuted}> · {story.priority}</Text>}
          {badges.length > 0 && <Text color={theme.inkMuted}> · {badges.join(' · ')}</Text>}
          <Text color={theme.inkFaint}> · updated {relativeDate(story.updatedAt, ctx?.now())}</Text>
        </Text>
        <Box marginTop={1}>
          <Tabs tabs={tabs} selected={tab} onSelect={setTab} active={active && viewing && !covered} />
        </Box>
      </Box>
      <ScrollBody
        active={active && viewing && !covered}
        height={layout.height === undefined ? undefined : Math.max(1, layout.height - 5)}
      >
        {tab === 0 && <DetailView rows={rows} body={story.description} />}
        {pluginTabs.map(
          ({ id, plugin, component: PluginTab }, i) =>
            tab === TABS.length + i && (
              <PluginSlot
                key={id}
                pluginId={plugin}
                render={(context, ui) => (
                  <PluginTab story={story} active={active && viewing} plugin={context} ui={ui} />
                )}
              />
            ),
        )}
      </ScrollBody>
      {mode === 'move' && (
        <Modal
          title={`${story.key} › Move Stage`}
          hints={[
            { key: 'enter', description: 'move' },
            { key: 'esc', description: 'back' },
          ]}
          onClose={() => setMode('view')}
        >
          <SelectList
            items={config.stages.map((s) => ({
              value: s.key,
              label: s.name,
              description: s.key === story.stage ? '(current)' : undefined,
            }))}
            onSelect={(item) => void move(item.value)}
          />
        </Modal>
      )}
      {mode === 'confirm-delete' && (
        <Modal title={`${story.key} › Delete`} onClose={() => setMode('view')}>
          <ConfirmDialog
            message={`Delete ${story.key} "${story.name}"?`}
            confirmLabel="Delete"
            cancelLabel="Cancel"
            destructive
            onConfirm={() => void remove()}
            onCancel={() => setMode('view')}
          />
        </Modal>
      )}
    </Box>
  );
}

/** Whether a Plugin that is on adds rows, so that the Story shows they are on their way. */
function pluginRowsExpected(ctx: RowblyContext | null): boolean {
  return (ctx?.plugins?.active() ?? []).some(({ definition }) => definition.storyRows !== undefined);
}
