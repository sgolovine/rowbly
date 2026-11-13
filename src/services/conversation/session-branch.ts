import { ValidationError } from "../errors/errors.js";
import type { EntryIndex } from "./session-types.js";

type Entries = ReadonlyMap<string, EntryIndex>;

/** The size limits of one page. */
export interface PageBounds {
  readonly limit: number;
  readonly maxBytes: number;
}

/** The entries that a page reads, oldest first, and the cursors around them. */
export interface BranchPage {
  readonly selected: readonly EntryIndex[];
  readonly bytes: number;
  readonly nextBefore: string | null;
  readonly nextAfter?: string | null;
}

/** The entries that a page takes, in the order of the walk. A closed selection takes no more entries. */
interface Selection {
  readonly selected: readonly EntryIndex[];
  readonly bytes: number;
  readonly open: boolean;
}

interface OlderWalk {
  readonly id: string | null | undefined;
  readonly selection: Selection;
}

interface Climb {
  readonly id: string | null | undefined;
  readonly steps: number;
}

const EMPTY: Selection = { selected: [], bytes: 0, open: true };

// Each recursive call of `climb` follows one parent link. Chunks keep the stack small on a long branch.
const CLIMB_CHUNK = 1024;

/** Adds an entry while the page has space. An entry over `maxBytes` is the last entry of the page. */
function take(selection: Selection, meta: EntryIndex, bounds: PageBounds): Selection {
  const { selected, bytes, open } = selection;
  const full = selected.length >= bounds.limit || (bytes + meta.length > bounds.maxBytes && selected.length > 0);

  if (!open || full) {
    return { ...selection, open: false };
  }

  return {
    selected: [...selected, meta],
    bytes: bytes + Math.min(meta.length, bounds.maxBytes),
    open: meta.length <= bounds.maxBytes,
  };
}

function entryAt(entries: Entries, id: string, visited: readonly EntryIndex[]): EntryIndex {
  const meta = entries.get(id);

  if (visited.some((entry) => entry.id === id)) {
    throw new ValidationError("Conversation branch has a cycle");
  }

  if (!meta) {
    throw new ValidationError("Conversation parent is missing");
  }

  return meta;
}

/** Walks from `walk.id` to older entries. The page limit bounds the depth of the recursion. */
function walkOlder(entries: Entries, walk: OlderWalk, bounds: PageBounds): OlderWalk {
  const { id, selection } = walk;

  if (!id || selection.selected.length >= bounds.limit) {
    return walk;
  }

  const meta = entryAt(entries, id, selection.selected);
  const next = take(selection, meta, bounds);
  const moved = { id: next.selected.at(-1) === meta ? meta.parentId : id, selection: next };

  return next.open ? walkOlder(entries, moved, bounds) : moved;
}

/** Reads the entries before `start`, from `start` back to older entries. */
export function olderPage(entries: Entries, start: string | null | undefined, bounds: PageBounds): BranchPage {
  const walk = walkOlder(entries, { id: start, selection: EMPTY }, bounds);
  const { selected, bytes } = walk.selection;

  return { selected: selected.toReversed(), bytes, nextBefore: walk.id ? (selected.at(-1)?.id ?? null) : null };
}

function isEnd(id: string | null | undefined, stop: string): boolean {
  return !id || id === stop;
}

/** Follows at most `budget` parent links. It stops at the root of the branch or at `stop`. */
function climb(entries: Entries, walk: Climb, stop: string, budget: number): Climb {
  if (budget === 0 || isEnd(walk.id, stop)) {
    return walk;
  }

  const meta = entries.get(walk.id as string);

  if (!meta) {
    throw new ValidationError("Conversation parent is missing");
  }

  return climb(entries, { id: meta.parentId, steps: walk.steps + 1 }, stop, budget - 1);
}

/** Follows at most `budget` parent links in chunks, because a branch can have many entries. */
function climbFar(entries: Entries, walk: Climb, stop: string, budget: number): Climb {
  const next = climb(entries, walk, stop, Math.min(budget, CLIMB_CHUNK));

  if (budget <= CLIMB_CHUNK || isEnd(next.id, stop)) {
    return next;
  }

  return climbFar(entries, next, stop, budget - CLIMB_CHUNK);
}

/**
 * Counts the entries from `start` back to the cursor, without the cursor. A branch without a cycle has at most
 * one step for each entry, so a walk that is not at its end after that many steps is in a cycle.
 */
function distanceTo(entries: Entries, start: string | null | undefined, cursor: string): number {
  const walk = climbFar(entries, { id: start, steps: 0 }, cursor, entries.size);

  if (!isEnd(walk.id, cursor)) {
    throw new ValidationError(
      entries.has(walk.id as string) ? "Conversation branch has a cycle" : "Conversation parent is missing",
    );
  }

  if (walk.id !== cursor) {
    throw new ValidationError("Conversation cursor is no longer available");
  }

  return walk.steps;
}

/** Gives at most `count` entries from `id` back to older entries, newest first. `count` is at most a page. */
function collect(entries: Entries, id: string | null | undefined, count: number): readonly EntryIndex[] {
  const meta = count > 0 && id ? entries.get(id) : undefined;

  return meta ? [meta, ...collect(entries, meta.parentId, count - 1)] : [];
}

/**
 * Reads the entries after `cursor`, from the cursor to newer entries. The index has no child links, so the walk
 * starts at the leaf. Only the entries next to the cursor stay in memory.
 */
export function newerPage(
  entries: Entries,
  start: string | null | undefined,
  cursor: string,
  bounds: PageBounds,
): BranchPage {
  const distance = distanceTo(entries, start, cursor);
  const count = Math.min(distance, bounds.limit);
  const first = climbFar(entries, { id: start, steps: 0 }, cursor, distance - count);

  const candidates = collect(entries, first.id, count).toReversed();
  const { selected, bytes } = candidates.reduce((selection, meta) => take(selection, meta, bounds), EMPTY);

  return {
    selected,
    bytes,
    nextBefore: selected[0]?.id ?? null,
    nextAfter: selected.length < distance ? (selected.at(-1)?.id ?? null) : null,
  };
}
