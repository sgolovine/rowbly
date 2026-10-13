// Reading and writing the Stage and Custom Field lists at one Configuration Cascade level
// (contracts §3), shared by the stages and fields services.
import { toTimestamp } from '../core';
import { type ConfigLevel, type CustomFieldDef, DEFAULT_STAGES, type Slug, type Stage } from '../schemas';
import { createRepositories, type Repositories } from '../storage';
import type { ChangeSet } from './plugins/types';
import type { ConfigTarget, RowblyContext } from './types';

export type ConfigListKey = 'stages' | 'customFields';
type ItemOf<K extends ConfigListKey> = K extends 'stages' ? Stage : CustomFieldDef;

export interface LevelList<T> {
  /** The list in effect at the target level: its own, or the inherited one copy-on-write starts from. */
  items: T[];
  /** Where `items` comes from. */
  source: ConfigLevel;
  /** The Boards whose effective list is the target level's list. */
  affected: Slug[];
  /** Puts `next` at the target level into the Change Set. */
  save(changes: ChangeSet, next: T[]): Promise<void>;
}

/** Opens the `key` list at `target`, following the cascade upwards when the level has none of its own. */
export async function openLevel<K extends ConfigListKey>(
  ctx: RowblyContext,
  repos: Repositories,
  target: ConfigTarget,
  key: K,
): Promise<LevelList<ItemOf<K>>> {
  type T = ItemOf<K>;
  const root = await repos.rootConfig.get();
  const fallback = (): [T[], ConfigLevel] =>
    root[key]
      ? [root[key] as T[], 'global']
      : [(key === 'stages' ? DEFAULT_STAGES.map((s) => ({ ...s })) : []) as T[], 'default'];
  const now = toTimestamp(ctx.now());

  if (target.level === 'global') {
    const [items, source] = fallback();
    const affected = (await repos.boards.list()).filter((board) => !board[key]).map((board) => board.id);
    return {
      items,
      source,
      affected,
      save: async (changes, next) => {
        await changes.updateRootConfig((config) => ({ ...config, [key]: next }));
      },
    };
  }

  const board = await repos.boards.get(target.boardId);
  const [items, source]: [T[], ConfigLevel] = board[key] ? [board[key] as T[], 'board'] : fallback();
  return {
    items,
    source,
    affected: [board.id],
    save: async (changes, next) => {
      await changes.updateBoard(board.id, (current) => ({ ...current, [key]: next, updatedAt: now }));
    },
  };
}

/** The list at `target` and where it comes from, for showing which level is edited and what it inherits. */
export async function readLevel<K extends ConfigListKey>(
  ctx: RowblyContext,
  target: ConfigTarget,
  key: K,
): Promise<{ items: ItemOf<K>[]; source: ConfigLevel }> {
  const { items, source } = await openLevel(ctx, createRepositories(ctx.root), target, key);
  return { items, source };
}

/** The Boards a change to the `key` list at `target` applies to (contracts §3). */
export async function affectedBoards(ctx: RowblyContext, target: ConfigTarget, key: ConfigListKey): Promise<Slug[]> {
  return (await openLevel(ctx, createRepositories(ctx.root), target, key)).affected;
}

/** Index to insert at for `position`; `before`/`after` must name an existing key. */
export function insertIndex(
  keys: readonly string[],
  position: { before: string } | { after: string } | 'first' | 'last',
  notFound: (key: string) => Error,
): number {
  if (position === 'first') return 0;
  if (position === 'last') return keys.length;
  const anchor = 'before' in position ? position.before : position.after;
  const at = keys.indexOf(anchor);
  if (at === -1) throw notFound(anchor);
  return 'before' in position ? at : at + 1;
}
