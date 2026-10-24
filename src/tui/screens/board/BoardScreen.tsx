import { Box, type Key, Text, useInput, useWindowSize } from 'ink';
import { useEffect, useRef, useState } from 'react';
import type { Slug, Stage, Story } from '../../../schemas';
import { storyChoices } from '../../../services/stories';
import { ConfirmDialog, Form, type FormValues, Loading, Modal } from '../../components';
import {
  type ContextMenuItem,
  loadStoryBadges,
  type StoryBadges,
  useActionFocus,
  useAsync,
  useBoardSelection,
  useBoardView,
  useContextMenu,
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
  useSidebarFilter,
  useToast,
} from '../../hooks';
import { moveDelta } from '../../keymap';
import { useRouter } from '../../router';
import { theme } from '../../theme';
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
import { BoardList } from './BoardList';
import { Gutter } from './Gutter';
import {
  type Columns,
  cardsPerColumn,
  columnLayout,
  edgeCard,
  follow,
  groupColumns,
  LIST_ROW_HEIGHT,
  type ListRow,
  listRows,
  moveCard,
  placeCard,
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
 * the context: one column per Stage, Stories in Rank order. Moves and reorders show at once and are
 * reverted if the service refuses them. The list view (`v`, or the header's switch) shows the same Stories as
 * one list in a collapsible section per Stage, where shift+↑/↓ reorder a Story and, at a section's edge, move
 * it to the next Stage.
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
  const sidebarFilter = useSidebarFilter();
  const contextMenu = useContextMenu();
  const [filters, setFilters] = useState<FormValues>({});
  const [mode, setMode] = useState<Mode>('view');
  const [cursor, setCursor] = useState<Cursor>({ col: 0, row: 0 });
  const [columns, setColumns] = useState<Columns>([]);
  const { view, setView } = useBoardView();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [listCursor, setListCursor] = useState(0);
  const firstListRow = useRef(0);
  const writing = useRef(false);
  // Mirrors `writing` for rendering: the keys are ignored while a write runs, so their hints are hidden too.
  const [saving, setSaving] = useState(false);
  /** The column a card (its Story Key) is dragged over with the mouse, and the slot its drop shadow shows at. */
  const [dragOver, setDragOver] = useState<{ col: number; key: string; slot: number } | null>(null);
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
    // A Plugin Sidebar's pick applies unless the filter form sets that Plugin's filter.
    const plugin = { ...sidebarFilter.plugins, ...filter.plugins };
    const [stories, badges] = await Promise.all([
      services.stories.list(boardId, Object.keys(plugin).length > 0 ? { ...filter, plugins: plugin } : filter),
      loadStoryBadges(plugins, services),
    ]);
    return { boardId, stages: choices.stages, stories, badges, failures };
  }, [services, scope.data, filters, plugins, sidebarFilter]);
  // The list follows `scope.data`, so reloading the scope reloads both.
  useReloadOnReturn(scope.reload);
  // What is on screen: the columns, the Board and Stages they were grouped by, and the cards' badges.
  const [shown, setShown] = useState<{ boardId: Slug; stages: Stage[]; badges: StoryBadges } | null>(null);
  const stages = shown?.stages ?? [];

  // The Story highlighted on screen, so that a reload (after a change on disk) keeps it highlighted
  // where it moved to, and leaves the cursor in place only when the Story is gone.
  const highlighted = useRef<string | undefined>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs only when a load settles.
  useEffect(() => {
    // A load that was already running when a write started may predate it; the write reloads after.
    if (!list.data || writing.current) return;
    const next = groupColumns(list.data.stages, list.data.stories);
    setColumns(next);
    setShown({ boardId: list.data.boardId, stages: list.data.stages, badges: list.data.badges });
    const key = highlighted.current;
    if (key === undefined) return;
    const at = next.findIndex((cards) => cards.some((s) => s.key === key));
    if (at >= 0) setCursor({ col: at, row: next[at]?.findIndex((s) => s.key === key) ?? 0 });
    const line = listRows(list.data.stages, next, collapsed).findIndex(
      (r) => r.kind === 'story' && r.story.key === key,
    );
    if (line >= 0) setListCursor(line);
  }, [list.data]);

  const col = Math.max(0, Math.min(cursor.col, stages.length - 1));
  const row = Math.max(0, Math.min(cursor.row, (columns[col]?.length ?? 0) - 1));
  const card = columns[col]?.[row];
  const rows = listRows(stages, columns, collapsed);
  const listAt = Math.max(0, Math.min(listCursor, rows.length - 1));
  const listRow = rows[listAt];
  const listStory = listRow?.kind === 'story' ? listRow.story : undefined;
  // The Story the keys act on: the highlighted card, or the highlighted line of the list.
  const focused = view === 'list' ? listStory : card;
  highlighted.current = focused?.key;
  useActionFocus({ board: scope.data?.choices.board, story: focused });

  // Switching views keeps the same Story highlighted when the other view shows it.
  const seenView = useRef(view);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs only when the view changes.
  useEffect(() => {
    if (seenView.current === view) return;
    seenView.current = view;
    if (view === 'list' && card) {
      const at = rows.findIndex((r) => r.kind === 'story' && r.story.key === card.key);
      if (at >= 0) setListCursor(at);
    } else if (view === 'stages' && listStory) {
      const at = columns.findIndex((cards) => cards.some((s) => s.key === listStory.key));
      if (at >= 0) setCursor({ col: at, row: columns[at]?.findIndex((s) => s.key === listStory.key) ?? 0 });
    }
  }, [view]);

  /**
   * Shows `next` at once, then runs the write; on failure puts the board and cursor back and shows a
   * toast. Either way it then reloads the board from disk.
   */
  const write = async (next: Columns, nextCursor: Cursor, run: () => Promise<Story | undefined>) => {
    const before = { columns, cursor: { col, row }, listCursor: listAt, collapsed };
    writing.current = true;
    setSaving(true);
    setColumns(next);
    setCursor(nextCursor);
    try {
      const saved = await run();
      if (saved) setColumns((current) => replaceCard(current, saved));
    } catch (err) {
      setColumns(before.columns);
      setCursor(before.cursor);
      setListCursor(before.listCursor);
      setCollapsed(before.collapsed);
      toast.error(err);
    } finally {
      writing.current = false;
      setSaving(false);
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

  /**
   * A card dragged with the mouse onto column `to`, at `slot` among its cards: moved to that Stage if it is
   * another, then ranked before the card it lands above (or after the last one).
   */
  const drop = (to: number, key: unknown, slot: number) => {
    setDragOver(null);
    const stage = stages[to];
    const from = columns.findIndex((cards) => cards.some((s) => s.key === key));
    const at = columns[from]?.findIndex((s) => s.key === key) ?? -1;
    const moved = columns[from]?.[at];
    if (writing.current || !stage || !moved || (from === to && slot === at)) return;
    const others = (columns[to] ?? []).filter((s) => s.key !== moved.key);
    const next = placeCard(columns, from, at, to, slot, stage.key);
    const below = others[slot];
    const above = others[slot - 1];
    void write(next, { col: to, row: slot }, async () => {
      if (from !== to) {
        const saved = await services.stories.move(moved.key, stage.key, { top: slot === 0 });
        if (slot === 0 || !below) return saved;
      }
      return services.stories.rank(moved.key, below ? { before: below.key } : above ? { after: above.key } : 'bottom');
    });
  };

  /** A click selects a card (or a column, at row `-1`); a click on the selected card opens it. */
  const click = (at: Cursor) => {
    if (at.row < 0) return setCursor({ col: at.col, row: at.col === col ? row : 0 });
    const clicked = columns[at.col]?.[at.row];
    if (clicked && at.col === col && at.row === row) router.push('story', { key: clicked.key, title: clicked.key });
    else setCursor(at);
  };

  const toggleSection = (category: string, fold?: boolean) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (fold ?? !next.has(category)) next.add(category);
      else next.delete(category);
      return next;
    });

  /** A click selects a line of the list; a click on the selected line opens its Story or folds its section. */
  const clickRow = (at: number) => {
    const clicked = rows[at];
    if (!clicked) return;
    if (at !== listAt) setListCursor(at);
    else if (clicked.kind === 'section') toggleSection(clicked.category);
    else router.push('story', { key: clicked.story.key, title: clicked.story.key });
  };

  /**
   * Moves the list's highlighted Story one place up or down within its Stage; past the top or bottom it moves
   * to the previous Stage's bottom or the next Stage's top (from the first Stage in Board up to Backlog, from
   * the last down to Done). The cursor follows it, unfolding the section it lands in.
   */
  const moveInList = (delta: -1 | 1) => {
    if (listRow?.kind !== 'story') return;
    const { story } = listRow;
    const from = stages.findIndex((s) => s.key === listRow.stage.key);
    const at = columns[from]?.findIndex((s) => s.key === story.key) ?? -1;
    if (at < 0) return;
    const neighbour = columns[from]?.[at + delta];
    if (neighbour) {
      const next = swapCard(columns, from, at, delta);
      setListCursor(
        listRows(stages, next, collapsed).findIndex((r) => r.kind === 'story' && r.story.key === story.key),
      );
      const position = delta < 0 ? { before: neighbour.key } : { after: neighbour.key };
      void write(next, { col: from, row: at + delta }, () => services.stories.rank(story.key, position));
      return;
    }
    const to = from + delta;
    const target = stages[to];
    if (!target) return;
    const slot = delta < 0 ? Number.POSITIVE_INFINITY : 0;
    const next = placeCard(columns, from, at, to, slot, target.key);
    const unfolded = new Set(collapsed);
    unfolded.delete(target.key);
    toggleSection(target.key, false);
    setListCursor(listRows(stages, next, unfolded).findIndex((r) => r.kind === 'story' && r.story.key === story.key));
    const landed = delta < 0 ? (next[to]?.length ?? 1) - 1 : 0;
    void write(next, { col: to, row: landed }, () => services.stories.move(story.key, target.key, { top: delta > 0 }));
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

  /**
   * The board as last rendered, for a context menu's items: an item runs after the renders that opening
   * the menu caused, such as the one that moved the cursor to the right-clicked Story.
   */
  const board = { card, listStory, moveTo, reorder, rankTo, moveInList };
  const latest = useRef(board);
  latest.current = board;
  const open = (story: Story) => router.push('story', { key: story.key, title: story.key });
  const edit = (story: Story) => router.push('story-form', { key: story.key, title: `Edit ${story.key}` });

  /** A right click on a card selects it and opens a menu of what its keys do. */
  const cardMenu = (at: Cursor, x: number, y: number) => {
    const story = columns[at.col]?.[at.row];
    if (!story || writing.current) return;
    setCursor(at);
    const size = columns[at.col]?.length ?? 0;
    // Runs only if the cursor is still on the Story and no write is running, as the keys do.
    const act = (run: (now: typeof board) => void) => () => {
      if (!writing.current && latest.current.card?.key === story.key) run(latest.current);
    };
    const items: ContextMenuItem[] = [
      { label: 'Open', key: 'enter', onSelect: act(() => open(story)) },
      { label: 'Edit', key: 'e', onSelect: act(() => edit(story)) },
      {
        label: 'Move to previous Stage',
        key: 'shift+←',
        disabled: at.col === 0,
        onSelect: act((now) => now.moveTo(at.col - 1, at)),
      },
      {
        label: 'Move to next Stage',
        key: 'shift+→',
        disabled: at.col >= stages.length - 1,
        onSelect: act((now) => now.moveTo(at.col + 1, at)),
      },
      { label: 'Move up', key: 'shift+↑', disabled: at.row === 0, onSelect: act((now) => now.reorder(-1)) },
      { label: 'Move down', key: 'shift+↓', disabled: at.row >= size - 1, onSelect: act((now) => now.reorder(1)) },
      { label: 'Move to top', key: 'T', disabled: at.row === 0, onSelect: act((now) => now.rankTo('top')) },
      { label: 'Move to bottom', key: 'B', disabled: at.row >= size - 1, onSelect: act((now) => now.rankTo('bottom')) },
      { label: 'Delete', key: 'd', onSelect: act(() => setMode('confirm-delete')) },
    ];
    contextMenu.open(x, y, items);
  };

  /** A right click on a Story line of the list selects it and opens a menu of what its keys do. */
  const lineMenu = (at: number, x: number, y: number) => {
    const line = rows[at];
    if (line?.kind !== 'story' || writing.current) return;
    setListCursor(at);
    const { story } = line;
    // As moveInList: a Story moves past a section's edge into the next Stage, so only the first Story of
    // the first Stage cannot move up and only the last Story of the last Stage cannot move down.
    const from = stages.findIndex((s) => s.key === line.stage.key);
    const index = columns[from]?.findIndex((s) => s.key === story.key) ?? -1;
    const size = columns[from]?.length ?? 0;
    const act = (run: (now: typeof board) => void) => () => {
      if (!writing.current && latest.current.listStory?.key === story.key) run(latest.current);
    };
    contextMenu.open(x, y, [
      { label: 'Open', key: 'enter', onSelect: act(() => open(story)) },
      { label: 'Edit', key: 'e', onSelect: act(() => edit(story)) },
      {
        label: 'Move up',
        key: 'shift+↑',
        disabled: index < 0 || (index === 0 && from === 0),
        onSelect: act((now) => now.moveInList(-1)),
      },
      {
        label: 'Move down',
        key: 'shift+↓',
        disabled: index < 0 || (index >= size - 1 && from >= stages.length - 1),
        onSelect: act((now) => now.moveInList(1)),
      },
      { label: 'Delete', key: 'd', onSelect: act(() => setMode('confirm-delete')) },
    ]);
  };

  // Another Board picked in the sidebar starts from a clean view.
  const seenVersion = useRef(selection.version);
  useEffect(() => {
    if (seenVersion.current === selection.version) return;
    seenVersion.current = selection.version;
    setViewing(undefined);
    setFilters({});
    setCursor({ col: 0, row: 0 });
    setListCursor(0);
    firstCol.current = 0;
    firstListRow.current = 0;
    firstRows.current.clear();
  }, [selection.version]);

  useKeyCapture(active && mode === 'filter', { escape: true });
  useEscape(active && mode === 'filter', () => setMode('view'));
  // The filter and delete Modals show their own keys; only the top layer's keys show.
  useKeyHints(
    saving || mode !== 'view'
      ? []
      : view === 'list'
        ? [
            { key: '↑/↓', description: 'select' },
            { key: 'enter', description: 'open/fold' },
            { key: 'shift+↑/↓', description: 'move', secondary: true },
            { key: '←/→', description: 'fold/unfold section', secondary: true },
            { key: 'n', description: 'new Story' },
            { key: 'e', description: 'edit', secondary: true },
            { key: 'd', description: 'delete', secondary: true },
            { key: '/', description: 'filter' },
            { key: 'c', description: 'clear filter', secondary: true },
            { key: 'v', description: 'Stages view' },
            { key: 'r', description: 'reload', secondary: true },
            { key: 'j/k', description: 'select (vim keys)', secondary: true },
            { key: 'K/J', description: 'move (vim keys)', secondary: true },
          ]
        : [
            { key: '←/→ ↑/↓', description: 'select' },
            { key: 'enter', description: 'open' },
            { key: 'shift+←/→', description: 'move Stage', secondary: true },
            { key: 'shift+↑/↓', description: 'reorder', secondary: true },
            { key: 'T/B', description: 'to top/bottom', secondary: true },
            { key: 'n', description: 'new Story' },
            { key: 'e', description: 'edit', secondary: true },
            { key: 'd', description: 'delete', secondary: true },
            { key: '/', description: 'filter' },
            { key: 'c', description: 'clear filter', secondary: true },
            { key: 'v', description: 'list view' },
            { key: 'r', description: 'reload', secondary: true },
            { key: 'h/l j/k', description: 'select (vim keys)', secondary: true },
            { key: 'H/L', description: 'move Stage (vim keys)', secondary: true },
            { key: 'K/J', description: 'reorder (vim keys)', secondary: true },
          ],
  );

  /** The list view's keys; `n` adds to the highlighted Story's Stage, or a section's first Stage. */
  const listInput = (input: string, key: Key, boardId: Slug) => {
    const delta = moveDelta(input, key);
    const section = listRow?.kind === 'section' ? listRow : undefined;
    // shift+↑/↓ (or K/J) move the Story up / down, across Stages at a section's edge; plain ↑/↓ (or k/j) move
    // the cursor.
    if (input === 'K' || (key.shift && key.upArrow)) moveInList(-1);
    else if (input === 'J' || (key.shift && key.downArrow)) moveInList(1);
    else if (delta) setListCursor(Math.max(0, Math.min(rows.length - 1, listAt + delta)));
    else if (section && (key.return || input === ' ')) toggleSection(section.category);
    else if (section && key.leftArrow) toggleSection(section.category, true);
    else if (section && key.rightArrow) toggleSection(section.category, false);
    else if (key.return && listStory) router.push('story', { key: listStory.key, title: listStory.key });
    else if (input === 'e' && listStory)
      router.push('story-form', { key: listStory.key, title: `Edit ${listStory.key}` });
    else if (input === 'd' && listStory) setMode('confirm-delete');
    else if (input === 'n') router.push('story-form', { boardId, stage: stageFor(listRow), title: 'New Story' });
    else if (input === '/') setMode('filter');
    else if (input === 'c') setFilters({});
    else if (input === 'r') scope.reload();
  };

  const stageFor = (at: ListRow | undefined) =>
    at?.kind === 'story' ? at.stage.key : stages.find((s) => s.key === at?.category)?.key;

  useInput(
    (input, key) => {
      if (!scope.data || writing.current) return;
      const { boardId } = scope.data;
      if (input === 'v') return setView(view === 'list' ? 'stages' : 'list');
      if (view === 'list') return listInput(input, key, boardId);
      const delta = moveDelta(input, key);
      // shift+arrows (or H/L/K/J) move the Story; plain arrows (or h/l/j/k) move the cursor.
      if (input === 'H' || (key.shift && key.leftArrow)) moveTo(col - 1);
      else if (input === 'L' || (key.shift && key.rightArrow)) moveTo(col + 1);
      else if (input === 'K' || (key.shift && key.upArrow)) reorder(-1);
      else if (input === 'J' || (key.shift && key.downArrow)) reorder(1);
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
  const scrolled = view === 'stages' && hiddenLeft + hiddenRight > 0;
  const described = describeWithPlugins(describeFilters(filters), plugins, scope.data?.extra, filters);
  const summary = [described.summary, sidebarFilter.summary].filter(Boolean).join(' · ');
  const boardId = scope.data?.boardId;
  const inContext = ctx?.local.board === boardId;

  const label = scope.data && {
    title: scope.data.choices.board.name,
    detail: [
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
    return scope.loading ? <Loading label="Loading Board…" /> : <Text color={theme.danger}>No Board.</Text>;
  }
  const { choices, extra } = scope.data;
  // Without a fixed height (tests), size to the terminal less the shell's header and footer, and the
  // title line and gap when the label is shown here.
  const height = (room.height ?? termRows - 3) - (inHeader ? 0 : 2);
  const size = cardsPerColumn(height);
  // The list view's scroll markers take a line above and below it.
  const listSize = Math.max(1, Math.floor((height - 2) / LIST_ROW_HEIGHT));
  firstListRow.current = follow(firstListRow.current, listAt, listSize, rows.length);

  return (
    <Box flexDirection="column">
      {!inHeader && (
        <Text wrap="truncate-end">
          <Text bold>{label.title}</Text>
          <Text color={theme.inkFaint}>{` ${label.detail}`}</Text>
        </Text>
      )}
      <PluginFailures failures={[...(list.data?.failures ?? []), ...described.failures]} />
      {!shown || shown.boardId !== boardId ? (
        <Loading label="Loading Stories…" />
      ) : view === 'list' ? (
        <Box marginTop={inHeader ? 0 : 1}>
          <BoardList
            rows={rows}
            stages={stages}
            storyBadges={shown.badges}
            width={room.width}
            first={firstListRow.current}
            size={listSize}
            cursor={listAt}
            active={active && mode === 'view'}
            onClick={clickRow}
            onContextMenu={lineMenu}
          />
        </Box>
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
                storyBadges={shown.badges}
                width={layout.width}
                first={first}
                size={size}
                selected={index === col ? row : null}
                active={active && mode === 'view'}
                onClick={(at) => click({ col: index, row: at })}
                onContextMenu={(at, x, y) => cardMenu({ col: index, row: at }, x, y)}
                onDrop={(key, slot) => drop(index, key, slot)}
                onDragOver={(key, slot) =>
                  setDragOver((over) =>
                    typeof key !== 'string' || (over?.col === index && over.key === key && over.slot === slot)
                      ? over
                      : { col: index, key, slot },
                  )
                }
                onDragLeave={() => setDragOver((over) => (over?.col === index ? null : over))}
                drag={dragOver?.col === index ? dragOver : null}
              />
            );
          })}
          {scrolled && <Gutter text={hiddenRight > 0 ? `${hiddenRight}›` : ''} />}
        </Box>
      )}
      {mode === 'filter' && (
        <Modal title="Filter Stories" onClose={() => setMode('view')} hints={[{ key: 'esc', description: 'cancel' }]}>
          <PluginFailures failures={extra.failures} note="its filter is unavailable" />
          <Form
            fields={[...filterFields({ labels: choices.labels }, { board: true }), ...extra.fields]}
            initialValues={{ ...extra.values, ...filterInitialValues(filters) }}
            submitLabel="apply"
            onSubmit={(values) => {
              setFilters(values);
              setMode('view');
            }}
          />
        </Modal>
      )}
      {mode === 'confirm-delete' && focused && (
        <Modal
          size="dialog"
          title="Delete Story"
          hints={[
            { key: 'y', description: 'delete' },
            { key: 'esc', description: 'cancel' },
          ]}
          onClose={() => setMode('view')}
        >
          <ConfirmDialog
            message={`Delete ${focused.key} "${focused.name}"?`}
            confirmLabel="Delete"
            cancelLabel="Cancel"
            destructive
            onConfirm={() => remove(focused)}
            onCancel={() => setMode('view')}
          />
        </Modal>
      )}
    </Box>
  );
}
