// Pieces shared by the Stages and Custom Fields screens.
import { Box, Text } from 'ink';
import { UsageError } from '../../../core';
import type { ConfigLevel, Slug } from '../../../schemas';
import type { ConfigTarget } from '../../../services';
import { useAsync, useServices } from '../../hooks';
import { theme } from '../../theme';

export type LevelName = ConfigTarget['level'];

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

export function levelsFor(scope: ConfigScope): LevelName[] {
  return scope.boardId ? ['board', 'global'] : ['global'];
}

export function targetFor(scope: ConfigScope, level: LevelName): ConfigTarget {
  if (level === 'board' && scope.boardId) return { level: 'board', boardId: scope.boardId };
  return { level: 'global' };
}

/** Which level is being edited and where its list currently comes from. */
export function LevelBar({ levels, level, source }: { levels: LevelName[]; level: LevelName; source?: ConfigLevel }) {
  return (
    <Box gap={1}>
      <Box flexShrink={0}>
        <Text color={theme.inkFaint}>Level:</Text>
      </Box>
      {levels.map((name) => (
        <Box key={name} flexShrink={0}>
          <Text backgroundColor={name === level ? theme.selection : undefined} color={theme.ink}>
            {` ${name} `}
          </Text>
        </Box>
      ))}
      {source && (
        <Text color={theme.inkFaint} wrap="truncate-end">
          {source === level ? '· own list' : `· inherited from ${source} (copied to ${level} on first edit)`}
        </Text>
      )}
    </Box>
  );
}
