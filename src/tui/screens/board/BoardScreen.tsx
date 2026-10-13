import { Box, Text, useInput, useWindowSize } from 'ink';
import { useEffect, useRef, useState } from 'react';
import { type BoardRef, type Priority, PrioritySchema, type Stage, type Story } from '../../../schemas';
import type { StoryFilter } from '../../../services';
import { storyChoices } from '../../../services/stories';
import { ConfirmDialog, Form, type FormValues, Loading, SelectList } from '../../components';
import {
  useAsync,
  useIsActive,
  useKeyCapture,
  useKeyHints,
  useRowblyContext,
  useServices,
  useToast,
} from '../../hooks';
import { moveDelta } from '../../keymap';
import { useRouter } from '../../router';
import { useEscape } from '../stages/shared';
import { NONE, useReloadOnReturn } from '../stories/shared';
import type { ScreenProps } from '../types';
import { BoardColumn } from './BoardColumn';
import {
  type Columns,
  cardsPerColumn,
  columnLayout,
  edgeCard,
  follow,
  GUTTER_WIDTH,
  groupColumns,
  moveCard,
  removeCard,
  replaceCard,
  swapCard,
} from './layout';

/** The select choice meaning "do not filter on this". */
const ANY = '(any)';

type Mode = 'view' | 'filter' | 'switch' | 'confirm-delete';

/** The cursor: a column (Stage index) and a card within it. */
interface Cursor {
  col: number;
  row: number;
}

/**
 * The Kanban board for the Board in context (`b` switches it): one column per Stage, cards in Rank
 * order. Moves and reorders show at once and are reverted if the service refuses them.
 */
export function BoardScreen(_props: ScreenProps) {
  const services = useServices();
  const ctx = useRowblyContext();
  const toast = useToast();
  const router = useRouter();
  const active = useIsActive();
  const { columns: termWidth, rows: termRows } = useWindowSize();
  const [filters, setFilters] = useState<FormValues>({});
  const [mode, setMode] = useState<Mode>('view');
  const [cursor, setCursor] = useState<Cursor>({ col: 0, row: 0 });
  const [columns, setColumns] = useState<Columns>([]);
  const writing = useRef(false);
  const firstCol = useRef(0);
  const firstRows = useRef(new Map<string, number>());

  const scope = useAsync(async () => {
    const ref = await services.context.resolveBoard();
    if (!ctx) throw new Error('no Data Root');
    return { ref, choices: await storyChoices(ctx, ref) };
  }, [services, ctx]);
  const list = useAsync(async () => {
    if (!scope.data) return null;
    const { ref, choices } = scope.data;
    return { ref, stages: choices.stages, stories: await services.stories.list(ref, toFilter(filters)) };
  }, [services, scope.data, filters]);
  const boards = useAsync(
    async () => (mode === 'switch' && scope.data ? services.boards.list(scope.data.ref.workspaceId) : null),
    [services, mode, scope.data],
  );
  // The list follows `scope.data`, so reloading the scope reloads both.
  useReloadOnReturn(scope.reload);
  // What is on screen: the columns and the Board and Stages they were grouped by.
  const [shown, setShown] = useState<{ ref: BoardRef; stages: Stage[] } | null>(null);
  const stages = shown?.stages ?? [];

  useEffect(() => {
    // A load that was already running when a write started may predate it; the write reloads after.
    if (!list.data || writing.current) return;
    setColumns(groupColumns(list.data.stages, list.data.stories));
    setShown({ ref: list.data.ref, stages: list.data.stages });
  }, [list.data]);

  const col = Math.max(0, Math.min(cursor.col, stages.length - 1));
  const row = Math.max(0, Math.min(cursor.row, (columns[col]?.length ?? 0) - 1));
  const card = columns[col]?.[row];

  /**
   * Shows `next` at once, then runs the write; on failure puts the board and cursor back and shows a
   * toast. Either way it then reloads the board from disk.
   */
  const write = async (next: Columns, nextCursor: Cursor, run: () => Promise<Story | undefined>) => {
    const before = { columns, cursor: { col, row } };
    writing.current = true;
    setColumns(next);
    setCursor(nextCursor);
    try {
      const saved = await run();
      if (saved) setColumns((current) => replaceCard(current, saved));
    } catch (err) {
      setColumns(before.columns);
      setCursor(before.cursor);
      toast.error(err);
    } finally {
      writing.current = false;
      // Supersedes any load still in flight (for example the reload on return), which could be stale.
      list.reload();
    }
  };

  const moveTo = (to: number) => {
    const stage = stages[to];
    if (!card || !stage) return;
    const next = moveCard(columns, col, row, to, stage.key);
    void write(next, { col: to, row: (next[to]?.length ?? 1) - 1 }, () => services.stories.move(card.key, stage.key));
  };

  const reorder = (delta: -1 | 1) => {
    const neighbour = columns[col]?.[row + delta];
    if (!card || !neighbour) return;
    const position = delta < 0 ? { before: neighbour.key } : { after: neighbour.key };
    void write(swapCard(columns, col, row, delta), { col, row: row + delta }, () =>
      services.stories.rank(card.key, position),
    );
  };

  const rankTo = (edge: 'top' | 'bottom') => {
    const size = columns[col]?.length ?? 0;
    const to = edge === 'top' ? 0 : size - 1;
    if (!card || to === row) return;
    void write(edgeCard(columns, col, row, edge), { col, row: to }, () => services.stories.rank(card.key, edge));
  };

  const remove = (story: Story) => {
    setMode('view');
    void write(removeCard(columns, story.key), { col, row }, async () => {
      await services.stories.remove(story.key);
      toast.push('info', `Deleted ${story.key}`);
      return undefined;
    });
  };

  const switchTo = async (ref: BoardRef) => {
    try {
      await services.context.use(ref.workspaceId, ref.boardId);
      scope.reload();
      setFilters({});
      setCursor({ col: 0, row: 0 });
      firstCol.current = 0;
      firstRows.current.clear();
    } catch (err) {
      toast.error(err);
    }
    setMode('view');
  };

  useKeyCapture(active && (mode === 'filter' || mode === 'switch'), { escape: true });
  useEscape(active && (mode === 'filter' || mode === 'switch'), () => setMode('view'));
  useKeyHints(
    mode === 'view'
      ? [
          { key: 'h/l j/k', description: 'select' },
          { key: 'enter', description: 'open' },
          { key: 'H/L', description: 'move Stage' },
          { key: 'K/J', description: 'reorder' },
          { key: 'T/B', description: 'to top/bottom' },
          { key: 'n', description: 'new' },
          { key: 'e', description: 'edit' },
          { key: 'd', description: 'delete' },
          { key: '/', description: 'filter' },
          { key: 'c', description: 'clear filter' },
          { key: 'b', description: 'switch Board' },
          { key: 'r', description: 'reload' },
        ]
      : [{ key: 'esc', description: 'cancel' }],
  );

  useInput(
    (input, key) => {
      if (!scope.data || writing.current) return;
      const { ref } = scope.data;
      const delta = moveDelta(input, key);
      if (input === 'H') moveTo(col - 1);
      else if (input === 'L') moveTo(col + 1);
      else if (input === 'K') reorder(-1);
      else if (input === 'J') reorder(1);
      else if (input === 'T') rankTo('top');
      else if (input === 'B') rankTo('bottom');
      else if (input === 'h' || key.leftArrow) setCursor({ col: Math.max(0, col - 1), row });
      else if (input === 'l' || key.rightArrow) setCursor({ col: Math.min(stages.length - 1, col + 1), row });
      else if (delta) setCursor({ col, row: Math.max(0, row + delta) });
      else if (key.return && card) router.push('story', { key: card.key, title: card.key });
      else if (input === 'e' && card) router.push('story-form', { key: card.key, title: `Edit ${card.key}` });
      else if (input === 'd' && card) setMode('confirm-delete');
      else if (input === 'n') router.push('story-form', { ref, stage: stages[col]?.key, title: 'New Story' });
      else if (input === '/') setMode('filter');
      else if (input === 'c') setFilters({});
      else if (input === 'b') setMode('switch');
      else if (input === 'r') scope.reload();
    },
    { isActive: active && mode === 'view' },
  );

  if (!scope.data) return scope.loading ? <Loading label="Loading Board…" /> : <Text color="red">No Board.</Text>;
  const { ref, choices } = scope.data;

  // The shell pads the screen by one column on each side.
  const layout = columnLayout(stages.length, termWidth - 2);
  firstCol.current = follow(firstCol.current, col, layout.visible, stages.length);
  const shownStages = stages.slice(firstCol.current, firstCol.current + layout.visible);
  const hiddenLeft = firstCol.current;
  const hiddenRight = stages.length - firstCol.current - shownStages.length;
  const scrolled = hiddenLeft + hiddenRight > 0;
  const size = cardsPerColumn(termRows);
  const summary = describeFilters(filters);

  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text bold>{choices.board.name}</Text>
        <Text dimColor>
          {` ${ref.workspaceId}/${ref.boardId}`}
          {scrolled ? ` · Stages ${hiddenLeft + 1}–${hiddenLeft + shownStages.length} of ${stages.length}` : ''}
          {summary ? ` · filter: ${summary}` : ''}
        </Text>
      </Text>
      {shown?.ref.workspaceId !== ref.workspaceId || shown.ref.boardId !== ref.boardId ? (
        <Loading label="Loading Stories…" />
      ) : (
        <Box marginTop={1}>
          {scrolled && <Gutter text={hiddenLeft > 0 ? `‹${hiddenLeft}` : ''} />}
          {shownStages.map((stage, i) => {
            const index = hiddenLeft + i;
            const cards = columns[index] ?? [];
            const first = follow(firstRows.current.get(stage.key) ?? 0, index === col ? row : 0, size, cards.length);
            firstRows.current.set(stage.key, first);
            return (
              <BoardColumn
                key={stage.key}
                stage={stage}
                cards={cards}
                stages={stages}
                width={layout.width}
                first={first}
                size={size}
                selected={index === col ? row : null}
                active={active && mode === 'view'}
              />
            );
          })}
          {scrolled && <Gutter text={hiddenRight > 0 ? `${hiddenRight}›` : ''} />}
        </Box>
      )}
      {mode === 'filter' && (
        <Box flexDirection="column">
          <Text bold>Filter Stories</Text>
          <Form
            fields={[
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
              { name: 'search', label: 'Text', kind: 'text' },
            ]}
            initialValues={{ assignee: ANY, label: ANY, priority: ANY, epic: ANY, ...filters }}
            onSubmit={(values) => {
              setFilters(values);
              setMode('view');
            }}
          />
        </Box>
      )}
      {mode === 'switch' && (
        <Box flexDirection="column">
          <Text bold>Switch Board</Text>
          {boards.data ? (
            <SelectList
              items={boards.data.map((b) => ({
                value: b.id,
                label: b.name,
                description: b.id === ref.boardId ? `${b.id} (current)` : b.id,
              }))}
              onSelect={(item) => void switchTo({ workspaceId: ref.workspaceId, boardId: item.value })}
            />
          ) : (
            <Loading label="Loading Boards…" />
          )}
        </Box>
      )}
      {mode === 'confirm-delete' && card && (
        <ConfirmDialog
          message={`Delete ${card.key} "${card.name}" with its Tasks and Comments?`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => remove(card)}
          onCancel={() => setMode('view')}
        />
      )}
    </Box>
  );
}

/** The column indicator shown at the edge when Stages are scrolled out of view on that side. */
function Gutter({ text }: { text: string }) {
  return (
    <Box width={GUTTER_WIDTH} flexShrink={0}>
      <Text color="cyan" wrap="truncate-end">
        {text}
      </Text>
    </Box>
  );
}

function chosen(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' && value !== ANY ? value : undefined;
}

function toFilter(filters: FormValues): StoryFilter {
  const assignees = [chosen(filters.assignee), filters.me === true ? 'me' : undefined].filter((a) => a !== undefined);
  const label = chosen(filters.label);
  const priority = chosen(filters.priority) as Priority | undefined;
  const epic = chosen(filters.epic);
  const search = chosen(filters.search);
  return {
    ...(assignees.length > 0 ? { assignees } : {}),
    ...(label ? { labels: [label] } : {}),
    ...(priority ? { priorities: [priority] } : {}),
    ...(epic ? { epicId: epic === NONE ? null : epic } : {}),
    ...(search ? { search } : {}),
  };
}

function describeFilters(filters: FormValues): string {
  const parts = [
    chosen(filters.assignee) && `@${filters.assignee}`,
    filters.me === true && 'mine',
    chosen(filters.label) && `#${filters.label}`,
    chosen(filters.priority),
    chosen(filters.epic) && (filters.epic === NONE ? 'no Epic' : `Epic ${filters.epic}`),
    chosen(filters.search) && `"${filters.search}"`,
  ];
  return parts.filter(Boolean).join(' · ');
}
