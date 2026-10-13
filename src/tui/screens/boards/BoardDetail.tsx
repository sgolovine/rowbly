import { Box, Text, useInput } from 'ink';
import { describeSource } from '../../../output';
import type { BoardRef } from '../../../schemas';
import { storyCountsByStage } from '../../../services/boards';
import { DetailView, Loading, StageBadge } from '../../components';
import { useAsync, useIsActive, useKeyHints, useRowblyContext, useServices } from '../../hooks';
import { useRouter } from '../../router';
import { describeField } from '../fields';
import { useReloadOnReturn } from '../stories/shared';
import type { ScreenProps } from '../types';

/**
 * One Board (`params.ref`, default: the Board in context), like `boards show` and `config show`:
 * its key prefix and description, Stories per Stage, and the effective Stages and Custom Fields
 * with the Configuration Cascade level each list comes from. Opening its board or Stories from here
 * does not change the context.
 */
export function BoardDetailScreen({ params }: ScreenProps) {
  const services = useServices();
  const ctx = useRowblyContext();
  const router = useRouter();
  const active = useIsActive();
  const data = useAsync(async () => {
    const ref = (params.ref as BoardRef | undefined) ?? (await services.context.resolveBoard());
    if (!ctx) throw new Error('no Data Root');
    const [config, counts] = await Promise.all([services.config.effective(ref), storyCountsByStage(ctx, ref)]);
    return { ref, config, counts };
  }, [services, ctx, params.ref]);
  useReloadOnReturn(data.reload);

  useKeyHints([
    { key: 'v', description: 'view board' },
    { key: 'o', description: 'Stories' },
    { key: 's', description: 'stages' },
    { key: 'f', description: 'fields' },
  ]);
  useInput(
    (input) => {
      if (!data.data) return;
      const { ref, config } = data.data;
      const name = config.board.name;
      if (input === 'v') router.push('board', { ref });
      else if (input === 'o') router.push('stories', { ref, title: `${name} Stories` });
      else if (input === 's') router.push('stages', { ref, title: `${name} Stages` });
      else if (input === 'f') router.push('fields', { ref, title: `${name} Fields` });
    },
    { isActive: active },
  );

  if (!data.data) return data.loading ? <Loading label="Loading Board…" /> : <Text color="red">No Board.</Text>;
  const { ref, config, counts } = data.data;
  const { board } = config;
  const unknown = Object.keys(counts).filter((key) => !config.stages.some((s) => s.key === key));

  return (
    <Box flexDirection="column" gap={1}>
      <DetailView
        rows={[
          { label: 'Board', value: `${ref.workspaceId}/${board.id}` },
          { label: 'Name', value: board.name },
          { label: 'Key prefix', value: board.keyPrefix },
        ]}
        body={board.description}
      />
      <Box flexDirection="column">
        <Text>
          <Text bold>Stages</Text> <Text dimColor>({describeSource(config.stagesSource)})</Text>
        </Text>
        {config.stages.map((s) => (
          <Text key={s.key}>
            {'  '}
            <StageBadge stage={s} /> <Text dimColor>{`${s.key} · ${s.category}`}</Text> {plural(counts[s.key] ?? 0)}
          </Text>
        ))}
        {unknown.map((key) => (
          <Text key={key} color="yellow">
            {'  '}
            {plural(counts[key] ?? 0)} in unknown Stage "{key}" (run Doctor)
          </Text>
        ))}
      </Box>
      <Box flexDirection="column">
        <Text>
          <Text bold>Custom Fields</Text> <Text dimColor>({describeSource(config.customFieldsSource)})</Text>
        </Text>
        {config.customFields.length === 0 ? (
          <Text dimColor>{'  '}none</Text>
        ) : (
          config.customFields.map((f) => (
            <Text key={f.key}>
              {'  '}
              {f.name}
              {f.required ? '*' : ''} <Text dimColor>{`${f.key} · ${describeField(f)}`}</Text>
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
}

function plural(n: number): string {
  return `${n} ${n === 1 ? 'Story' : 'Stories'}`;
}
