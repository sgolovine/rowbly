import { errorMessage, PluginError } from '../core';
import type { Slug } from '../schemas';
import { createRepositories } from '../storage';
import { assertOutsideCoordination, coordinated } from './coordination';
import { frozenCopy } from './plugins/changeSet';
import { currentScope } from './plugins/executionScope';
import { invokePlugin } from './plugins/invoke';
import type { BoardStatDefinition, BoardStatValue, PluginBoardStatsContext } from './plugins/types';
import type { RowblyContext, Services } from './types';

export type BoardStat = BoardStatDefinition & BoardStatValue;
export interface BoardStats {
  board: { id: string; name: string };
  window: 'all-time';
  metrics: BoardStat[];
  plugins: { id: string; name: string; metrics: BoardStat[] }[];
}

/** One local snapshot, then bounded Plugin reads outside its lock (ADR-0054). */
export async function boardStats(
  ctx: RowblyContext,
  services: Services,
  boardId: Slug,
  signal?: AbortSignal,
): Promise<BoardStats> {
  // Refuse a hook/display callback before it can turn a held lock into a network read.
  if (currentScope()) throw new PluginError('Board Stats can only be collected from a command or screen');
  await assertOutsideCoordination(ctx.root);
  signal?.throwIfAborted();
  const { config, stories, entries } = await coordinated(ctx.root, 'boards.stats', async () => ({
    config: await services.config.effective(boardId),
    stories: await services.stories.list(boardId, {}),
    entries: (await createRepositories(ctx.root).rootConfig.get()).plugins,
  }));
  const done = new Set(config.stages.filter((stage) => stage.category === 'done').map((stage) => stage.key));
  const result: BoardStats = {
    board: { id: config.board.id, name: config.board.name },
    window: 'all-time',
    metrics: [
      { key: 'stories', label: 'Stories', status: 'complete', value: stories.length },
      {
        key: 'stories-done',
        label: 'Stories currently Done',
        status: 'complete',
        value: stories.filter((story) => done.has(story.stage)).length,
      },
    ],
    plugins: [],
  };
  const host = ctx.plugins;
  for (const definition of host?.registry ?? []) {
    const stats = definition.boardStats;
    if (!stats) continue;
    const status = host?.status().find((entry) => entry.id === definition.id);
    let values: Record<string, BoardStatValue> = {};
    const enabled = entries?.[definition.id]?.enabled === true;
    let reason = enabled ? (status?.reason ?? 'Plugin unavailable') : 'Plugin is off';
    if (enabled && host?.active().some((entry) => entry.definition.id === definition.id)) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error('Stats refresh reached its 30-second limit')),
        30_000,
      );
      const context = services.plugins.context(definition.id);
      const lifetime = AbortSignal.any([controller.signal, context.externalReadSignal, ...(signal ? [signal] : [])]);
      const plugin: PluginBoardStatsContext = Object.freeze({
        inspectBag: context.inspectBag,
        externalReadSignal: lifetime,
        externalRead: (name, parameters, options) =>
          context.externalRead(name, parameters, {
            signal: AbortSignal.any([lifetime, ...(options?.signal ? [options.signal] : [])]),
          }),
      });
      try {
        values = await invokePlugin({ plugin: definition.id, stage: 'board-stats' }, async () => {
          lifetime.throwIfAborted();
          const collected = await abortable(lifetime, () =>
            stats.collect({ board: frozenCopy(config.board), stories: frozenCopy(stories), plugin }),
          );
          validateValues(stats.metrics, collected);
          return collected;
        });
      } catch (error) {
        reason = errorMessage(error);
      } finally {
        clearTimeout(timeout);
        controller.abort();
      }
    }
    result.plugins.push({
      id: definition.id,
      name: definition.name,
      metrics: stats.metrics.map((metric) => ({
        ...metric,
        ...(values[metric.key] ?? { status: 'unavailable' as const, value: null, reason }),
      })),
    });
  }
  signal?.throwIfAborted();
  return result;
}

function validateValues(definitions: readonly BoardStatDefinition[], values: Record<string, BoardStatValue>): void {
  if (
    !values ||
    typeof values !== 'object' ||
    Array.isArray(values) ||
    Object.keys(values).length !== definitions.length ||
    definitions.some(({ key }) => {
      const metric = values[key];
      if (!metric) return true;
      if (metric.reason !== undefined && (typeof metric.reason !== 'string' || !metric.reason.trim())) return true;
      if (metric.status === 'unavailable') return metric.value !== null || !metric.reason;
      return (
        !['complete', 'partial'].includes(metric.status) ||
        !Number.isSafeInteger(metric.value) ||
        metric.value < 0 ||
        (metric.status === 'partial' && !metric.reason)
      );
    })
  )
    throw new PluginError('Board Stats collector returned invalid metrics');
}

/** A collector cannot retain its live execution scope beyond cancellation/deadline. */
async function abortable<T>(signal: AbortSignal, collect: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  let abort = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve().then(collect), cancelled]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
