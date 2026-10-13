// Pure helpers for the board view: grouping Stories into columns, optimistic edits and scrolling.
import type { Stage, Story } from '../../../schemas';

/** A column is never narrower than this; when the Stages do not all fit, the view scrolls. */
export const MIN_COLUMN_WIDTH = 24;
/** Width of the `‹`/`›` gutters shown when columns are scrolled out of view. */
export const GUTTER_WIDTH = 3;
/** Lines per card, including the gap below it. */
export const CARD_HEIGHT = 4;
/** Terminal lines used by everything except the cards: shell header and footer, board title, column headers. */
const CHROME_HEIGHT = 12;

/** One list of Stories per Stage, in Stage order. Stories in an unknown Stage (drift) are left out. */
export type Columns = Story[][];

/** `stories` must already be sorted by Rank, as `services.stories.list` returns them. */
export function groupColumns(stages: readonly Stage[], stories: readonly Story[]): Columns {
  return stages.map((stage) => stories.filter((s) => s.stage === stage.key));
}

/** Moves the card at `from[col][row]` to the bottom of column `to`, in Stage `stage`. */
export function moveCard(columns: Columns, col: number, row: number, to: number, stage: string): Columns {
  const card = columns[col]?.[row];
  if (!card) return columns;
  return columns.map((cards, i) => {
    if (i === col) return cards.filter((_, j) => j !== row);
    if (i === to) return [...cards, { ...card, stage }];
    return cards;
  });
}

/** Swaps the card at `row` with its neighbour `row + delta` in the same column. */
export function swapCard(columns: Columns, col: number, row: number, delta: -1 | 1): Columns {
  const cards = columns[col];
  const card = cards?.[row];
  const other = cards?.[row + delta];
  if (!card || !other) return columns;
  return columns.map((list, i) => {
    if (i !== col) return list;
    const next = [...list];
    next[row] = other;
    next[row + delta] = card;
    return next;
  });
}

/** Moves the card at `row` to the top or the bottom of its column. */
export function edgeCard(columns: Columns, col: number, row: number, edge: 'top' | 'bottom'): Columns {
  const card = columns[col]?.[row];
  if (!card) return columns;
  return columns.map((list, i) => {
    if (i !== col) return list;
    const rest = list.filter((_, j) => j !== row);
    return edge === 'top' ? [card, ...rest] : [...rest, card];
  });
}

export function removeCard(columns: Columns, key: string): Columns {
  return columns.map((cards) => cards.filter((s) => s.key !== key));
}

/** Replaces the card with the saved Story, keeping its position on screen. */
export function replaceCard(columns: Columns, story: Story): Columns {
  return columns.map((cards) => cards.map((s) => (s.key === story.key ? story : s)));
}

/** `✓ done/total` over the Story's Tasks, judged by Stage Category; `null` without Tasks. */
export function taskSummary(story: Pick<Story, 'tasks'>, stages: readonly Stage[]): string | null {
  if (story.tasks.length === 0) return null;
  const done = story.tasks.filter((t) => stages.find((s) => s.key === t.stage)?.category === 'done').length;
  return `✓ ${done}/${story.tasks.length}`;
}

/** Cuts `text` to `width` characters, ending in `…` when cut. */
export function truncate(text: string, width: number): string {
  if (width <= 0) return '';
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}

/** How many columns fit in `width` terminal columns, and how wide each one is. */
export function columnLayout(stageCount: number, width: number): { visible: number; width: number } {
  const count = Math.max(stageCount, 1);
  if (count * MIN_COLUMN_WIDTH <= width) return { visible: count, width: Math.floor(width / count) };
  const room = width - 2 * GUTTER_WIDTH;
  const visible = Math.max(1, Math.floor(room / MIN_COLUMN_WIDTH));
  return { visible, width: Math.max(MIN_COLUMN_WIDTH, Math.floor(room / visible)) };
}

/** How many cards fit in a column on a terminal `rows` lines high. */
export function cardsPerColumn(rows: number): number {
  return Math.max(1, Math.floor((rows - CHROME_HEIGHT) / CARD_HEIGHT));
}

/** The first visible item of a window of `size` over `total` items, moved as little as possible to show `index`. */
export function follow(first: number, index: number, size: number, total: number): number {
  let next = Math.min(first, index);
  if (index >= next + size) next = index - size + 1;
  return Math.max(0, Math.min(next, total - size));
}
