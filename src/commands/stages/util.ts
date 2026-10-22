import { UsageError } from '../../core';
import type { ConfigTarget, Position, RowblyContext, Services } from '../../services';
import { affectedBoards, type ConfigListKey } from '../../services/_configTarget';
import { boardFlag } from '../shared';
import type { LevelFlags, MutationResult, StageOptions } from './types';

const LEVELS = ['board', 'global'] as const;

/**
 * The Configuration Cascade level to read or edit. `--level` wins; otherwise `board` when a Board is
 * in context, else `global` (contracts §3).
 */
export async function resolveConfigTarget(services: Services, opts: LevelFlags): Promise<ConfigTarget> {
  const level = opts.level;
  if (level !== undefined && !LEVELS.includes(level as (typeof LEVELS)[number])) {
    throw new UsageError(`invalid --level "${level}"`, { hint: 'expected board or global' });
  }
  if (level === 'global') return { level: 'global' };
  if (level === 'board') return { level: 'board', boardId: await services.context.resolveBoard(boardFlag(opts)) };
  try {
    return { level: 'board', boardId: await services.context.resolveBoard(boardFlag(opts)) };
  } catch (err) {
    // No Board in context: fall back to the global level.
    if (!(err instanceof UsageError)) throw err;
    return { level: 'global' };
  }
}

export async function mutationResult<T>(
  ctx: RowblyContext,
  target: ConfigTarget,
  key: ConfigListKey,
  items: T[],
): Promise<MutationResult<T>> {
  return { level: target.level, items, affectedBoards: await affectedBoards(ctx, target, key) };
}

/** At most one of `--before`, `--after` (and, for `move`, `--first`, `--last`). */
export function parsePosition(opts: StageOptions, allowEnds: boolean): Position | undefined {
  const given: Position[] = [];
  if (opts.before !== undefined) given.push({ before: opts.before });
  if (opts.after !== undefined) given.push({ after: opts.after });
  if (allowEnds && opts.first) given.push('first');
  if (allowEnds && opts.last) given.push('last');
  if (given.length > 1) throw new UsageError('pass only one position flag');
  return given[0];
}
