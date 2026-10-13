import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { type Priority, PrioritySchema } from '../../../schemas';
import type { StoryFilter } from '../../../services';
import { storyChoices } from '../../../services/stories';
import { Form, type FormValues, Loading } from '../../components';
import { useAsync, useIsActive, useKeyCapture, useKeyHints, useRowblyContext, useServices } from '../../hooks';
import { useRouter } from '../../router';
import { CursorRows, useCursor, useEscape } from '../stages/shared';
import type { ScreenProps } from '../types';
import { boardRefFor, NONE, StoryStage, useReloadOnReturn } from './shared';

/** The select choice meaning "do not filter on this". */
const ANY = '(any)';

/** Filter form values, kept so reopening the form shows the current filters. */
type Filters = FormValues;

/** The Stories of a Board (`params.ref`, default: the Board in context), with filters. */
export function StoryListScreen({ params }: ScreenProps) {
  const services = useServices();
  const ctx = useRowblyContext();
  const router = useRouter();
  const active = useIsActive();
  const [filters, setFilters] = useState<Filters>({});
  const [filtering, setFiltering] = useState(false);
  const scope = useAsync(async () => {
    const ref = await boardRefFor(services, params);
    if (!ctx) throw new Error('no Data Root');
    return { ref, choices: await storyChoices(ctx, ref) };
  }, [services, ctx, params.ref]);
  const list = useAsync(
    async () => (scope.data ? services.stories.list(scope.data.ref, toFilter(filters)) : null),
    [services, scope.data, filters],
  );
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
          { key: 'f', description: 'filter' },
          { key: 'c', description: 'clear filters' },
        ],
  );

  useInput(
    (input, key) => {
      if (!scope.data) return;
      if (input === 'n') router.push('story-form', { ref: scope.data.ref, title: 'New Story' });
      else if (input === 'f') setFiltering(true);
      else if (input === 'c') setFilters({});
      else if (key.return && stories[cursor]) {
        const story = stories[cursor];
        router.push('story', { key: story.key, title: story.key });
      }
    },
    { isActive: active && !filtering },
  );

  if (!scope.data) return scope.loading ? <Loading label="Loading Stories…" /> : <Text color="red">No Board.</Text>;
  const { ref, choices } = scope.data;
  const summary = describeFilters(filters);

  return (
    <Box flexDirection="column" gap={1}>
      <Text dimColor>
        Board {ref.workspaceId}/{ref.boardId}
        {summary ? ` · filters: ${summary}` : ''}
      </Text>
      {!list.data ? (
        <Loading label="Loading Stories…" />
      ) : stories.length === 0 ? (
        <Text dimColor>{summary ? 'No Stories match.' : 'No Stories yet. Press n to create one.'}</Text>
      ) : (
        <CursorRows
          cursor={cursor}
          active={active && !filtering}
          rows={stories.map((s) => (
            <Text key={s.key}>
              <Text color="cyan">{s.key}</Text> {s.name} <StoryStage stages={choices.stages} story={s} />
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
              { name: 'stage', label: 'Stage', kind: 'select', options: [ANY, ...choices.stages.map((s) => s.key)] },
              {
                name: 'assignee',
                label: 'Assignee',
                kind: 'select',
                options: [ANY, ...choices.assignees.map((a) => a.handle)],
              },
              { name: 'me', label: 'Assigned to me', kind: 'boolean' },
              { name: 'label', label: 'Label', kind: 'select', options: [ANY, ...choices.labels] },
              { name: 'priority', label: 'Priority', kind: 'select', options: [ANY, ...PrioritySchema.options] },
              { name: 'epic', label: 'Epic', kind: 'select', options: [ANY, NONE, ...choices.epics.map((e) => e.id)] },
              { name: 'search', label: 'Search', kind: 'text' },
            ]}
            initialValues={{ stage: ANY, assignee: ANY, label: ANY, priority: ANY, epic: ANY, ...filters }}
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

function chosen(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' && value !== ANY ? value : undefined;
}

function toFilter(filters: Filters): StoryFilter {
  const stage = chosen(filters.stage);
  const assignees = [chosen(filters.assignee), filters.me === true ? 'me' : undefined].filter((a) => a !== undefined);
  const label = chosen(filters.label);
  const priority = chosen(filters.priority) as Priority | undefined;
  const epic = chosen(filters.epic);
  const search = chosen(filters.search);
  return {
    ...(stage ? { stages: [stage] } : {}),
    ...(assignees.length > 0 ? { assignees } : {}),
    ...(label ? { labels: [label] } : {}),
    ...(priority ? { priorities: [priority] } : {}),
    ...(epic ? { epicId: epic === NONE ? null : epic } : {}),
    ...(search ? { search } : {}),
  };
}

function describeFilters(filters: Filters): string {
  const parts = [
    chosen(filters.stage) && `stage ${filters.stage}`,
    chosen(filters.assignee) && `@${filters.assignee}`,
    filters.me === true && 'mine',
    chosen(filters.label) && `#${filters.label}`,
    chosen(filters.priority),
    chosen(filters.epic) && (filters.epic === NONE ? 'no Epic' : `Epic ${filters.epic}`),
    chosen(filters.search) && `"${filters.search}"`,
  ];
  return parts.filter(Boolean).join(' · ');
}
