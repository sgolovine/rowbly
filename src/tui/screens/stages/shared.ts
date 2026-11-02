// Pieces shared by the Stages and Custom Fields screens.
import { UsageError } from '../../../core';
import type { Slug } from '../../../schemas';
import type { ConfigTarget } from '../../../services';
import { useAsync, useServices } from '../../hooks';

/** The Board in context, from route params or the current context. */
export interface ConfigScope {
  boardId: Slug | null;
}

/**
 * Resolves the scope once: `params.global` keeps to the global level, else `params.boardId` wins,
 * else the context Board, else no Board (global only).
 */
export function useConfigScope(params: Record<string, unknown>) {
  const services = useServices();
  return useAsync<ConfigScope>(async () => {
    if (params.global === true) return { boardId: null };
    const given = params.boardId as Slug | undefined;
    if (given) return { boardId: given };
    try {
      return { boardId: await services.context.resolveBoard() };
    } catch (err) {
      if (!(err instanceof UsageError)) throw err;
      return { boardId: null };
    }
  }, [services, params.global, params.boardId]);
}

/** The route selects one Configuration Cascade level for the entire screen. */
export function targetFor(scope: ConfigScope): ConfigTarget {
  return scope.boardId ? { level: 'board', boardId: scope.boardId } : { level: 'global' };
}
