// Pieces shared by the Boards, Stages and Custom Fields screens.
import { Box, Text, useInput } from 'ink';
import { type ReactNode, useEffect, useState } from 'react';
import { UsageError } from '../../../core';
import type { ConfigLevel, Slug } from '../../../schemas';
import type { ConfigTarget } from '../../../services';
import { useAsync, useServices } from '../../hooks';
import { moveDelta } from '../../keymap';

export type LevelName = ConfigTarget['level'];

/** The Board in context, from route params or the current context. */
export interface ConfigScope {
  boardId: Slug | null;
}

/** Resolves the scope once: `params.boardId` wins, else the context Board, else no Board (global only). */
export function useConfigScope(params: Record<string, unknown>) {
  const services = useServices();
  return useAsync<ConfigScope>(async () => {
    const given = params.boardId as Slug | undefined;
    if (given) return { boardId: given };
    try {
      return { boardId: await services.context.resolveBoard() };
    } catch (err) {
      if (!(err instanceof UsageError)) throw err;
      return { boardId: null };
    }
  }, [services, params.boardId]);
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
        <Text dimColor>Level:</Text>
      </Box>
      {levels.map((name) => (
        <Box key={name} flexShrink={0}>
          <Text inverse={name === level} color={name === level ? 'cyan' : undefined}>
            {` ${name} `}
          </Text>
        </Box>
      ))}
      {source && (
        <Text dimColor wrap="truncate-end">
          {source === level ? '· own list' : `· inherited from ${source} (copied to ${level} on first edit)`}
        </Text>
      )}
    </Box>
  );
}

/** A cursor over `length` rows, moved with `↑/↓`/`j/k` while `active`. */
export function useCursor(length: number, active: boolean): [number, (index: number) => void] {
  const [cursor, setCursor] = useState(0);
  const clamped = Math.max(0, Math.min(cursor, length - 1));
  useEffect(() => {
    if (clamped !== cursor) setCursor(clamped);
  }, [clamped, cursor]);
  useInput(
    (input, key) => {
      const delta = moveDelta(input, key);
      if (delta) setCursor(Math.max(0, Math.min(length - 1, clamped + delta)));
    },
    { isActive: active },
  );
  return [clamped, setCursor];
}

/** Rows with a `›` marker on the cursor row. */
export function CursorRows({ rows, cursor, active }: { rows: ReactNode[]; cursor: number; active: boolean }) {
  return (
    <Box flexDirection="column">
      {rows.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional.
        <Box key={i}>
          <Text color={i === cursor && active ? 'cyan' : undefined}>{i === cursor ? '› ' : '  '}</Text>
          {row}
        </Box>
      ))}
    </Box>
  );
}

/** Cancels the open form or dialog on `esc` instead of leaving the screen. */
export function useEscape(active: boolean, onEscape: () => void): void {
  useInput(
    (_input, key) => {
      if (key.escape) onEscape();
    },
    { isActive: active },
  );
}
