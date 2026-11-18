import type { ConversationEntry, ConversationPage } from "../../../services/conversation/conversation.js";
import { Store } from "../../../services/store/store.js";
import type { ConversationLine } from "../conversation-lines.js";

/** The entries of one read. */
export const PAGE_ENTRIES = 20;
/** The most entries that the view keeps: three pages. It drops the entries furthest from the view. */
const MAX_ENTRIES = 3 * PAGE_ENTRIES;

/** The entries that the view keeps, and what it knows about the history around them. */
export interface ConversationWindow {
  readonly entries: readonly ConversationEntry[];
  /** The history has entries before the first entry of the window. */
  readonly older: boolean;
  /** The history has entries after the last entry of the window. */
  readonly newer: boolean;
  /** New entries arrived while the view was not at the end. */
  readonly fresh: boolean;
  readonly status: ConversationPage["status"] | "loading" | "error";
  readonly error?: string;
}

/** An entry of the window and its terminal rows. */
export interface EntryBlock {
  readonly entry: ConversationEntry;
  readonly lines: readonly ConversationLine[];
}

/** The rows of the window that are in view. */
export interface Viewport {
  /** The rows of all entries of the window. */
  readonly total: number;
  /** The rows in view, without the status row. */
  readonly rows: number;
  /** The last first row: the first row in view when the view is at the end. */
  readonly max: number;
  /** The first row in view. */
  readonly start: number;
}

/** The part of an entry that is in view. */
export interface ShownPart {
  readonly id: string;
  readonly lines: readonly ConversationLine[];
}

export const LOADING: ConversationWindow = { entries: [], older: false, newer: false, fresh: false, status: "loading" };

/** The window of the newest page. */
export function newestWindow(page: ConversationPage): ConversationWindow {
  return { entries: page.entries, older: page.nextBefore !== null, newer: false, fresh: false, status: page.status };
}

/** The window of a conversation that Rowbly cannot read. */
export function errorWindow(error: unknown): ConversationWindow {
  return { ...LOADING, status: "error", error: error instanceof Error ? error.message : String(error) };
}

/** The window with an older page before it. The newest entries leave when the window holds more than three pages. */
export function olderWindow(now: ConversationWindow, page: ConversationPage): ConversationWindow {
  const entries = [...page.entries, ...now.entries];
  const kept = entries.slice(0, MAX_ENTRIES);

  return { ...now, entries: kept, older: page.nextBefore !== null, newer: now.newer || kept.length < entries.length };
}

/** The window with a newer page after it, and the oldest entries that leave it to keep at most three pages. */
export function newerWindow(
  now: ConversationWindow,
  page: ConversationPage,
): { readonly window: ConversationWindow; readonly dropped: readonly ConversationEntry[] } {
  const entries = [...now.entries, ...page.entries];
  const dropped = entries.slice(0, Math.max(0, entries.length - MAX_ENTRIES));
  const newer = page.nextAfter !== null && page.nextAfter !== undefined;
  const window = {
    ...now,
    entries: entries.slice(dropped.length),
    older: now.older || dropped.length > 0,
    newer,
    fresh: newer && now.fresh,
  };

  return { window, dropped };
}

/**
 * The window after the watch reads the end of the history. While the user reads the history (`follow` is off),
 * the new entries wait below, and the view does not move.
 */
export function watchedWindow(now: ConversationWindow, page: ConversationPage, follow: boolean): ConversationWindow {
  const last = now.entries.at(-1)?.id;
  const at = last === undefined ? -1 : page.entries.findIndex((entry) => entry.id === last);
  const added = at >= 0 ? page.entries.slice(at + 1) : page.entries;

  if (now.status === "loading" || now.status === "error") {
    return now;
  }

  if (added.length === 0 && page.status === now.status) {
    return now;
  }

  if (!follow || now.newer) {
    return { ...now, newer: true, fresh: true };
  }

  // The last entry of the window left the history, for example after a new branch: show the end again.
  if (at < 0) {
    return newestWindow(page);
  }

  return appendedWindow(now, added, page.status);
}

function appendedWindow(
  now: ConversationWindow,
  added: readonly ConversationEntry[],
  status: ConversationPage["status"],
): ConversationWindow {
  const entries = [...now.entries, ...added];

  return { ...now, entries: entries.slice(-MAX_ENTRIES), older: now.older || entries.length > MAX_ENTRIES, status };
}

/** The rows of `blocks` in view. Without a `height`, all rows show. `end` keeps the last row in view. */
export function viewport(blocks: readonly EntryBlock[], height: number | undefined, offset: number | "end"): Viewport {
  const total = blocks.reduce((n, block) => n + block.lines.length, 0);
  const rows = height === undefined ? total : Math.max(1, height - 1);
  const max = Math.max(0, total - rows);
  const start = offset === "end" ? max : Math.max(0, Math.min(offset, max));

  return { total, rows, max, start };
}

/** The part of one block in view. `row` holds the first row of the block, and moves to the next block. */
function shownPart(row: Store<{ readonly at: number }>, block: EntryBlock, port: Viewport): ShownPart[] {
  const { at } = row.current;
  const from = Math.max(port.start - at, 0);
  const to = Math.min(port.start + port.rows - at, block.lines.length);

  row.update(() => ({ at: at + block.lines.length }));

  return from < to ? [{ id: block.entry.id, lines: block.lines.slice(from, to) }] : [];
}

/** The entries in view, each cut to its rows in view. */
export function shownParts(blocks: readonly EntryBlock[], port: Viewport): ShownPart[] {
  const row = new Store({ at: 0 });

  return blocks.flatMap((block) => shownPart(row, block, port));
}

function rangeText({ total, start, rows }: Viewport): string {
  return total > 0 ? `${start + 1}–${Math.min(total, start + rows)} of ${total} rows` : "No entries";
}

function newerText(view: ConversationWindow): string | undefined {
  if (view.fresh) {
    return "↓ new entries";
  }

  return view.newer ? "↓ newer" : undefined;
}

function followText(view: ConversationWindow, port: Viewport, follow: boolean): string {
  const atEnd = port.start >= port.max && !view.newer;

  return follow && atEnd ? "following" : "f follow";
}

/** The status row below the entries: the rows in view, the history around them and the follow state. */
export function statusText(view: ConversationWindow, port: Viewport, live: boolean, follow: boolean): string {
  return [
    rangeText(port),
    view.older ? "↑ older" : undefined,
    newerText(view),
    live ? followText(view, port, follow) : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}
