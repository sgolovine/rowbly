import { Box, Text, useInput, useWindowSize } from 'ink';
import { useEffect, useRef, useState } from 'react';
import type { Slug, Stage, Story } from '../../../schemas';
import { storyChoices } from '../../../services/stories';
import { ConfirmDialog, Form, type FormValues, Loading, Modal } from '../../components';
import {
  useActionFocus,
  useAsync,
  useBoardSelection,
  useEscape,
  useHeaderLabel,
  useIsActive,
  useKeyCapture,
  useKeyHints,
  useLayout,
  usePlugins,
  useReloadOnReturn,
  useRowblyContext,
  useServices,
  useToast,
} from '../../hooks';
import { moveDelta } from '../../keymap';
import { useRouter } from '../../router';
import {
  describeFilters,
  describeWithPlugins,
  filterFields,
  filterInitialValues,
  PluginFailures,
  storyFilterFields,
  toFilter,
  withPluginFilters,
} from '../stories';
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

type Mode = 'view' | 'filter' | 'confirm-delete';

/** The cursor: a column (Stage index) and a card within it. */
interface Cursor {
  col: number;
  row: number;
}

/**
 * The Kanban board for the Board in context (the sidebar switches it), or for `params.boardId` without changing
 * the context: one column per Stage, cards in Rank order. Moves and reorders show at once and are
 * reverted if the service refuses them.
 */
export function BoardScreen({ params }: ScreenProps) {
  const services = useServices();
  const ctx = useRowblyContext();
  const toast = useToast();
  const router = useRouter();
  const active = useIsActive();
  const { rows: termRows } = useWindowSize();
  const room = useLayout();
  const selection = useBoardSelection();
  const { plugins } = usePlugins();
  const [filters, setFilters] = useState<FormValues>({});
  const [mode, setMode] = useState<Mode>('view');
  const [cursor, setCursor] = useState<Cursor>({ col: 0, row: 0 });
  const [columns, setColumns] = useState<Columns>([]);
  const writing = useRef(false);
  const firstCol = useRef(0);
  const firstRows = useRef(new Map<string, number>());
  // A Board opened for viewing only; picking a Board in the sidebar drops it.
  const [viewing, setViewing] = useState(params.boardId as Slug | undefined);

  const scope = useAsync(async () => {
    const boardId = viewing ?? (await services.context.resolveBoard());
    if (!ctx) throw new Error('no Data Root');
    const extra = await storyFilterFields(plugins, services, boardId);
    return { boardId, choices: await storyChoices(ctx, boardId), extra };
    // `selection.version` reloads it when another Board is picked in the sidebar.
  }, [services, ctx, viewing, selection.version, plugins]);
  const list = useAsync(async () => {
    if (!scope.data) return null;
    const { boardId, choices } = scope.data;
    const { filter, failures } = withPluginFilters(toFilter(filters), plugins, scope.data.extra, filters);
    return { boardId, stages: choices.stages, stories: await services.stories.list(boardId, filter), failures };
  }, [services, scope.data, filters, plugins]);
  // The list follows `scope.data`, so reloading the scope reloads both.
  useReloadOnReturn(scope.reload);
  // What is on screen: the columns and the Board and Stages they were grouped by.
  const [shown, setShown] = useState<{ boardId: Slug; stages: Stage[] } | null>(null);
  const stages = shown?.stages ?? [];

  useEffect(() => {
    // A load that was already running when a write started may predate it; the write reloads after.
    if (!list.data || writing.current) return;
    setColumns(groupColumns(list.data.stages, list.data.stories));
    setShown({ boardId: list.data.boardId, stages: list.data.stages });
  }, [list.data]);

  const col = Math.max(0, Math.min(cursor.col, stages.length - 1));
  const row = Math.max(0, Math.min(cursor.row, (columns[col]?.length ?? 0) - 1));
  const card = columns[col]?.[row];
  useActionFocus({ board: scope.data?.choices.board, story: card });

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

  /** Moves the card at `from` (the cursor by default) to the bottom of column `to`. */
  const moveTo = (to: number, from: Cursor = { col, row }) => {
    const stage = stages[to];
    const moved = columns[from.col]?.[from.row];
    if (!moved || !stage || to === from.col) return;
    const next = moveCard(columns, from.col, from.row, to, stage.key);
    void write(next, { col: to, row: (next[to]?.length ?? 1) - 1 }, () => services.stories.move(moved.key, stage.key));
  };

  /** A card dragged with the mouse onto column `to`. */
  const drop = (to: number, key: unknown) => {
    if (writing.current) return;
    const from = columns.findIndex((cards) => cards.some((s) => s.key === key));
    if (from < 0) return;
    moveTo(to, { col: from, row: columns[from]?.findIndex((s) => s.key === key) ?? 0 });
  };

  /** A click selects a card (or a column, at row `-1`); a click on the selected card opens it. */
  const click = (at: Cursor) => {
    if (at.row < 0) return setCursor({ col: at.col, row: at.col === col ? row : 0 });
    const clicked = columns[at.col]?.[at.row];
    if (clicked && at.col === col && at.row === row) router.push('story', { key: clicked.key, title: clicked.key });
    else setCursor(at);
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

  // Another Board picked in the sidebar starts from a clean view.
  const seenVersion = useRef(selection.version);
  useEffect(() => {
    if (seenVersion.current === selection.version) return;
    seenVersion.current = selection.version;
    setViewing(undefined);
    setFilters({});
    setCursor({ col: 0, row: 0 });
    firstCol.current = 0;
    firstRows.current.clear();
  }, [selection.version]);

  useKeyCapture(active && mode === 'filter', { escape: true });
  useEscape(active && mode === 'filter', () => setMode('view'));
  useKeyHints(
    mode === 'view'
      ? [
          { key: 'h/l j/k', description: 'select' },
          { key: 'enter', description: 'open' },
          { key: 'H/L', description: 'move Stage', secondary: true },
          { key: 'K/J', description: 'reorder', secondary: true },
          { key: 'T/B', description: 'to top/bottom', secondary: true },
          { key: 'n', description: 'new' },
          { key: 'e', description: 'edit', secondary: true },
          { key: 'd', description: 'delete', secondary: true },
          { key: '/', description: 'filter' },
          { key: 'c', description: 'clear filter', secondary: true },
          { key: 'r', description: 'reload', secondary: true },
        ]
      : [{ key: 'esc', description: 'cancel' }],
  );

  useInput(
    (input, key) => {
      if (!scope.data || writing.current) return;
      const { boardId } = scope.data;
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
      else if (input === 'n') router.push('story-form', { boardId, stage: stages[col]?.key, title: 'New Story' });
      else if (input === '/') setMode('filter');
      else if (input === 'c') setFilters({});
      else if (input === 'r') scope.reload();
    },
    { isActive: active && mode === 'view' },
  );

  const layout = columnLayout(stages.length, room.width);
  firstCol.current = follow(firstCol.current, col, layout.visible, stages.length);
  const shownStages = stages.slice(firstCol.current, firstCol.current + layout.visible);
  const hiddenLeft = firstCol.current;
  const hiddenRight = stages.length - firstCol.current - shownStages.length;
  const scrolled = hiddenLeft + hiddenRight > 0;
  const described = describeWithPlugins(describeFilters(filters), plugins, scope.data?.extra, filters);
  const summary = described.summary;
  const boardId = scope.data?.boardId;
  const inContext = ctx?.local.board === boardId;

  const label = scope.data && {
    title: scope.data.choices.board.name,
    detail: [
      scope.data.boardId,
      scrolled ? `Stages ${hiddenLeft + 1}–${hiddenLeft + shownStages.length} of ${stages.length}` : '',
      viewing && !inContext ? 'viewing only (context unchanged)' : '',
      summary ? `filter: ${summary}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  };
  // The Board's name and state show in the shell's header, or above the columns in a modal.
  const inHeader = useHeaderLabel(label);

  if (!scope.data || !label) {
    return scope.loading ? <Loading label="Loading Board…" /> : <Text color="red">No Board.</Text>;
  }
  const { choices, extra } = scope.data;
  // Without a fixed height (tests), size to the terminal less the shell's header and footer, and the
  // title line and gap when the label is shown here.
  const size = cardsPerColumn((room.height ?? termRows - 3) - (inHeader ? 0 : 2));

  return (
    <Box flexDirection="column">
      {!inHeader && (
        <Text wrap="truncate-end">
          <Text bold>{label.title}</Text>
          <Text dimColor>{` ${label.detail}`}</Text>
        </Text>
      )}
      <PluginFailures failures={[...(list.data?.failures ?? []), ...described.failures]} />
      {shown?.boardId !== boardId ? (
        <Loading label="Loading Stories…" />
      ) : (
        <Box marginTop={inHeader ? 0 : 1}>
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
                onClick={(at) => click({ col: index, row: at })}
                onDrop={(key) => drop(index, key)}
              />
            );
          })}
          {scrolled && <Gutter text={hiddenRight > 0 ? `${hiddenRight}›` : ''} />}
        </Box>
      )}
      {mode === 'filter' && (
        <Modal title="Filter Stories" hints={[{ key: 'esc', description: 'cancel' }]}>
          <PluginFailures failures={extra.failures} note="its filter is unavailable" />
          <Form
            fields={[...filterFields({ labels: choices.labels }, { board: true }), ...extra.fields]}
            initialValues={{ ...extra.values, ...filterInitialValues(filters) }}
            onSubmit={(values) => {
              setFilters(values);
              setMode('view');
            }}
          />
        </Modal>
      )}
      {mode === 'confirm-delete' && card && (
        <Modal size="dialog">
          <ConfirmDialog
            message={`Delete ${card.key} "${card.name}" with its Tasks?`}
            confirmLabel="Delete"
            cancelLabel="Cancel"
            destructive
            onConfirm={() => remove(card)}
            onCancel={() => setMode('view')}
          />
        </Modal>
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
