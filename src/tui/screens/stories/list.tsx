import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import type { Stage } from '../../../schemas';
import { storyChoices } from '../../../services/stories';
import { Form, type FormValues, Loading } from '../../components';
import { useAsync, useIsActive, useKeyCapture, useKeyHints, useRowblyContext, useServices } from '../../hooks';
import { useRouter } from '../../router';
import { CursorRows, useCursor, useEscape } from '../stages/shared';
import type { ScreenProps } from '../types';
import { describeFilters, filterFields, filterInitialValues, toFilter } from './filter';
import { boardRefFor, StoryStage, useReloadOnReturn } from './shared';

/**
 * The Stories of a Board (`params.ref`, default: the Board in context), with filters. `A` toggles
 * every Board of its Workspace, like `stories list --all-boards`.
 */
export function StoryListScreen({ params }: ScreenProps) {
  const services = useServices();
  const ctx = useRowblyContext();
  const router = useRouter();
  const active = useIsActive();
  const [filters, setFilters] = useState<FormValues>({});
  const [filtering, setFiltering] = useState(false);
  const [allBoards, setAllBoards] = useState(false);
  const scope = useAsync(async () => {
    const ref = await boardRefFor(services, params);
    if (!ctx) throw new Error('no Data Root');
    return { ref, choices: await storyChoices(ctx, ref) };
  }, [services, ctx, params.ref]);
  // Every Board's Stages and Labels, only while showing all Boards.
  const workspace = useAsync(async () => {
    if (!allBoards || !scope.data) return null;
    const { workspaceId } = scope.data.ref;
    const boards = await services.boards.list(workspaceId);
    return Promise.all(
      boards.map(async (b) => {
        const ref = { workspaceId, boardId: b.id };
        const [config, labels] = await Promise.all([services.config.effective(ref), services.stories.labelsInUse(ref)]);
        return { boardId: b.id, stages: config.stages, labels };
      }),
    );
  }, [services, scope.data, allBoards]);
  const list = useAsync(async () => {
    if (!scope.data) return null;
    const { ref } = scope.data;
    return services.stories.list(allBoards ? { workspaceId: ref.workspaceId } : ref, toFilter(filters));
  }, [services, scope.data, filters, allBoards]);
  // The list follows `scope.data`, so reloading the scope reloads both.
  useReloadOnReturn(scope.reload);
  const stories = list.data ?? [];
  const [cursor] = useCursor(stories.length, active && !filtering);

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
      if (input === 'n') router.push('story-form', { ref: scope.data.ref, title: 'New Story' });
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
  const { ref, choices } = scope.data;
  const boards = allBoards ? workspace.data : null;
  const stagesOf = new Map<string, readonly Stage[]>(
    boards ? boards.map((b) => [b.boardId, b.stages]) : [[ref.boardId, choices.stages]],
  );
  const unique = (values: string[]) => [...new Set(values)];
  const summary = describeFilters(filters);
  const boardWidth = Math.max(0, ...stories.map((s) => s.boardId.length));

  return (
    <Box flexDirection="column" gap={1}>
      <Text dimColor>
        {allBoards ? `All Boards in ${ref.workspaceId}` : `Board ${ref.workspaceId}/${ref.boardId}`}
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
            fields={filterFields({
              // Across Boards, any Stage key or Label of any Board, like `--stage` with `--all-boards`.
              stages: unique([...stagesOf.values()].flatMap((stages) => stages.map((s) => s.key))),
              assignees: choices.assignees.map((a) => a.handle),
              labels: boards ? unique(boards.flatMap((b) => b.labels)).sort() : choices.labels,
              epics: choices.epics.map((e) => e.id),
            })}
            initialValues={filterInitialValues(filters)}
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
