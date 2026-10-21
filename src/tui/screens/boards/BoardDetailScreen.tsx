import { Box, Text, useInput } from 'ink';
import { describeSource } from '../../../output';
import type { Slug } from '../../../schemas';
import { storyCountsByStage } from '../../../services/boards';
import { DetailView, Loading, PluginSlot, StageBadge } from '../../components';
import {
  useActionFocus,
  useAsync,
  useIsActive,
  useKeyHints,
  usePlugins,
  useReloadOnReturn,
  useRowblyContext,
  useServices,
} from '../../hooks';
import { useRouter } from '../../router';
import { theme } from '../../theme';
import { describeField } from '../fields';
import type { ScreenProps } from '../types';

/**
 * One Board (`params.boardId`, default: the Board in context), like `boards show` and `config show`:
 * its key prefix and description, Stories per Stage, and the effective Stages and Custom Fields
 * with the Configuration Cascade level each list comes from, then the sections Plugins add. Opening
 * its board or Stories from here does not change the context.
 */
export function BoardDetailScreen({ params }: ScreenProps) {
  const services = useServices();
  const ctx = useRowblyContext();
  const router = useRouter();
  const active = useIsActive();
  const data = useAsync(async () => {
    const boardId = (params.boardId as Slug | undefined) ?? (await services.context.resolveBoard());
    if (!ctx) throw new Error('no Data Root');
    const [config, counts] = await Promise.all([services.config.effective(boardId), storyCountsByStage(ctx, boardId)]);
    return { config, counts };
  }, [services, ctx, params.boardId]);
  useReloadOnReturn(data.reload);
  useActionFocus({ board: data.data?.config.board });
  const { plugins } = usePlugins();

  useKeyHints([
    { key: 'v', description: 'view board' },
    { key: 'o', description: 'Stories' },
    { key: 's', description: 'stages' },
    { key: 'f', description: 'fields' },
  ]);
  useInput(
    (input) => {
      if (!data.data) return;
      const { id: boardId, name } = data.data.config.board;
      if (input === 'v') router.push('board', { boardId });
      else if (input === 'o') router.push('stories', { boardId, title: `${name} Stories` });
      else if (input === 's') router.push('stages', { boardId, title: `${name} Stages` });
      else if (input === 'f') router.push('fields', { boardId, title: `${name} Fields` });
    },
    { isActive: active },
  );

  if (!data.data)
    return data.loading ? <Loading label="Loading Board…" /> : <Text color={theme.danger}>No Board.</Text>;
  const { config, counts } = data.data;
  const { board } = config;
  const unknown = Object.keys(counts).filter((key) => !config.stages.some((s) => s.key === key));

  return (
    <Box flexDirection="column" gap={1}>
      <DetailView
        rows={[
          { label: 'Board', value: board.id },
          { label: 'Name', value: board.name },
          { label: 'Key prefix', value: board.keyPrefix },
        ]}
        body={board.description}
      />
      <Box flexDirection="column">
        <Text>
          <Text bold>Stages</Text> <Text color={theme.inkFaint}>({describeSource(config.stagesSource)})</Text>
        </Text>
        {config.stages.map((s) => (
          <Text key={s.key}>
            {'  '}
            <StageBadge stage={s} /> <Text color={theme.inkFaint}>{`${s.key} · ${s.category}`}</Text>{' '}
            {plural(counts[s.key] ?? 0)}
          </Text>
        ))}
        {unknown.map((key) => (
          <Text key={key} color={theme.stageBoard}>
            {'  '}
            {plural(counts[key] ?? 0)} in unknown Stage "{key}" (run Doctor)
          </Text>
        ))}
      </Box>
      <Box flexDirection="column">
        <Text>
          <Text bold>Custom Fields</Text>{' '}
          <Text color={theme.inkFaint}>({describeSource(config.customFieldsSource)})</Text>
        </Text>
        {config.customFields.length === 0 ? (
          <Text color={theme.inkFaint}>{'  '}none</Text>
        ) : (
          config.customFields.map((f) => (
            <Text key={f.key}>
              {'  '}
              {f.name}
              {f.required ? '*' : ''} <Text color={theme.inkFaint}>{`${f.key} · ${describeField(f)}`}</Text>
            </Text>
          ))
        )}
      </Box>
      {plugins.flatMap((p) =>
        (p.tui.boardSections ?? []).map((Section, i) => (
          <PluginSlot
            // biome-ignore lint/suspicious/noArrayIndexKey: a Plugin's sections keep their order.
            key={`${p.id}:${i}`}
            pluginId={p.id}
            render={(context, ui) => <Section board={board} plugin={context} ui={ui} />}
          />
        )),
      )}
    </Box>
  );
}

function plural(n: number): string {
  return `${n} ${n === 1 ? 'Story' : 'Stories'}`;
}
