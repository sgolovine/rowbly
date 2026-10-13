// Pieces shared by the Boards, Stages and Custom Fields screens.
import { Box, Text, useInput } from 'ink';
import { type ReactNode, useEffect, useState } from 'react';
import { UsageError } from '../../../core';
import type { BoardRef, ConfigLevel } from '../../../schemas';
import type { ConfigTarget } from '../../../services';
import { useAsync, useServices } from '../../hooks';
import { moveDelta } from '../../keymap';

export type LevelName = ConfigTarget['level'];

/** The Board and Workspace in context, from route params or the current context. */
export interface ConfigScope {
  ref: BoardRef | null;
  workspaceId: string;
}

/** Resolves the scope once: `params.ref` wins, else the context Board, else just the Workspace. */
export function useConfigScope(params: Record<string, unknown>) {
  const services = useServices();
  return useAsync<ConfigScope>(async () => {
    const given = params.ref as BoardRef | undefined;
    if (given) return { ref: given, workspaceId: given.workspaceId };
    try {
      const ref = await services.context.resolveBoard();
      return { ref, workspaceId: ref.workspaceId };
    } catch (err) {
      if (!(err instanceof UsageError)) throw err;
      return { ref: null, workspaceId: await services.context.resolveWorkspace() };
    }
  }, [services, params.ref]);
}

export function levelsFor(scope: ConfigScope): LevelName[] {
  return scope.ref ? ['board', 'workspace', 'global'] : ['workspace', 'global'];
}

export function targetFor(scope: ConfigScope, level: LevelName): ConfigTarget {
  if (level === 'global') return { level: 'global' };
  if (level === 'board' && scope.ref) return { level: 'board', ref: scope.ref };
  return { level: 'workspace', workspaceId: scope.workspaceId };
}

/** Which level is being edited and where its list currently comes from. */
export function LevelBar({ levels, level, source }: { levels: LevelName[]; level: LevelName; source?: ConfigLevel }) {
  return (
    <Box gap={1}>
      <Text dimColor>Level:</Text>
      {levels.map((name) => (
        <Text key={name} inverse={name === level} color={name === level ? 'cyan' : undefined}>
          {` ${name} `}
        </Text>
      ))}
      {source && (
        <Text dimColor>
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
