import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import type { Stage } from '../../../schemas';
import { storyChoices } from '../../../services/stories';
import { Form, type FormValues, Loading } from '../../components';
import {
  useActionFocus,
  useAsync,
  useIsActive,
  useKeyCapture,
  useKeyHints,
  usePlugins,
  useRowblyContext,
  useServices,
} from '../../hooks';
import { useRouter } from '../../router';
import { CursorRows, useCursor, useEscape } from '../stages/shared';
import type { ScreenProps } from '../types';
import { describeFilters, filterFields, filterInitialValues, toFilter } from './filter';
import { describeWithPlugins, storyFilterFields, withPluginFilters } from './pluginFields';
import { boardIdFor, StoryStage, useReloadOnReturn } from './shared';

/**
 * The Stories of a Board (`params.boardId`, default: the Board in context), with filters. `A` toggles
 * every Board, like `stories list --all-boards`.
 */
export function StoryListScreen({ params }: ScreenProps) {
  const services = useServices();
  const ctx = useRowblyContext();
  const router = useRouter();
  const active = useIsActive();
  const [filters, setFilters] = useState<FormValues>({});
  const [filtering, setFiltering] = useState(false);
  const [allBoards, setAllBoards] = useState(false);
  const { plugins } = usePlugins();
  const scope = useAsync(async () => {
    const boardId = await boardIdFor(services, params);
    if (!ctx) throw new Error('no Data Root');
    const extra = await storyFilterFields(plugins, services, boardId);
    return { boardId, choices: await storyChoices(ctx, boardId), extra };
  }, [services, ctx, params.boardId, plugins]);
  // Every Board's Stages and Labels, only while showing all Boards.
  const everyBoard = useAsync(async () => {
    if (!allBoards || !scope.data) return null;
    const boards = await services.boards.list();
    return Promise.all(
      boards.map(async (b) => {
        const [config, labels] = await Promise.all([
          services.config.effective(b.id),
          services.stories.labelsInUse(b.id),
        ]);
        return { boardId: b.id, stages: config.stages, labels };
      }),
    );
  }, [services, scope.data, allBoards]);
  const list = useAsync(async () => {
    if (!scope.data) return null;
    const filter = withPluginFilters(toFilter(filters), plugins, filters);
    return services.stories.list(allBoards ? null : scope.data.boardId, filter);
  }, [services, scope.data, filters, allBoards, plugins]);
  // The list follows `scope.data`, so reloading the scope reloads both.
  useReloadOnReturn(scope.reload);
  const stories = list.data ?? [];
  const [cursor] = useCursor(stories.length, active && !filtering);
  useActionFocus({ story: stories[cursor] });

  useKeyCapture(active && filtering, { escape: true });
  useEscape(active && filtering, () => setFiltering(false));
  useKeyHints(
    filtering
      ? [{ key: 'esc', description: 'cancel' }]
      : [
          { key: 'enter', description: 'open' },
          { key: 'n', description: 'new' },
          { key: '/', description: 'filter' },
          { key: 'c', description: 'clear filter' },
          { key: 'A', description: allBoards ? 'this Board only' : 'all Boards' },
        ],
  );

  useInput(
    (input, key) => {
      if (!scope.data) return;
      if (input === 'n') router.push('story-form', { boardId: scope.data.boardId, title: 'New Story' });
      else if (input === '/') setFiltering(true);
      else if (input === 'c') setFilters({});
      else if (input === 'A') setAllBoards((all) => !all);
      else if (key.return && stories[cursor]) {
        const story = stories[cursor];
        router.push('story', { key: story.key, title: story.key });
      }
    },
    { isActive: active && !filtering },
  );

  if (!scope.data) return scope.loading ? <Loading label="Loading Stories…" /> : <Text color="red">No Board.</Text>;
  const { boardId, choices, extra } = scope.data;
  const boards = allBoards ? everyBoard.data : null;
  const stagesOf = new Map<string, readonly Stage[]>(
    boards ? boards.map((b) => [b.boardId, b.stages]) : [[boardId, choices.stages]],
  );
  const unique = (values: string[]) => [...new Set(values)];
  const summary = describeWithPlugins(describeFilters(filters), plugins, filters);
  const boardWidth = Math.max(0, ...stories.map((s) => s.boardId.length));

  return (
    <Box flexDirection="column" gap={1}>
      <Text dimColor>
        {allBoards ? 'All Boards' : `Board ${boardId}`}
        {summary ? ` · filters: ${summary}` : ''}
      </Text>
      {!list.data || (allBoards && !boards) ? (
        <Loading label="Loading Stories…" />
      ) : stories.length === 0 ? (
        <Text dimColor>{summary ? 'No Stories match.' : 'No Stories yet. Press n to create one.'}</Text>
      ) : (
        <CursorRows
          cursor={cursor}
          active={active && !filtering}
          rows={stories.map((s) => (
            <Text key={s.key}>
              {allBoards ? <Text dimColor>{`${s.boardId.padEnd(boardWidth)}  `}</Text> : null}
              <Text color="cyan">{s.key}</Text> {s.name} <StoryStage stages={stagesOf.get(s.boardId) ?? []} story={s} />
              {s.priority ? <Text color="magenta"> {s.priority}</Text> : null}
              {s.assignees.length > 0 ? <Text dimColor> @{s.assignees.join(' @')}</Text> : null}
              {s.labels.length > 0 ? <Text dimColor> #{s.labels.join(' #')}</Text> : null}
              {s.dueDate ? <Text dimColor> due {s.dueDate}</Text> : null}
            </Text>
          ))}
        />
      )}
      {filtering && (
        <Box flexDirection="column">
          <Text bold>Filter Stories</Text>
          <Form
            fields={[
              ...filterFields({
                // Across Boards, any Stage key or Label of any Board, like `--stage` with `--all-boards`.
                stages: unique([...stagesOf.values()].flatMap((stages) => stages.map((s) => s.key))),
                assignees: choices.assignees.map((a) => a.handle),
                labels: boards ? unique(boards.flatMap((b) => b.labels)).sort() : choices.labels,
              }),
              ...extra.fields,
            ]}
            initialValues={{ ...extra.values, ...filterInitialValues(filters) }}
            onSubmit={(values) => {
              setFilters(values);
              setFiltering(false);
            }}
          />
        </Box>
      )}
    </Box>
  );
}
