import { Box, Text, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';
import { type BoardStats, boardStats } from '../../../services/boardStats';
import { Loading } from '../../components';
import { useIsActive, useKeyHints, useRowblyContext, useServices, useToast } from '../../hooks';
import { theme } from '../../theme';
import type { ScreenProps } from '../types';
import { BoardStatsSection } from './BoardStatsSection';

export function BoardStatsScreen({ params }: ScreenProps) {
  const ctx = useRowblyContext();
  const services = useServices();
  const toast = useToast();
  const active = useIsActive();
  const source = useRef({ ctx, boardId: params.boardId });
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<BoardStats>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh explicitly requests another collection.
  useEffect(() => {
    if (source.current.ctx !== ctx || source.current.boardId !== params.boardId) setData(undefined);
    source.current = { ctx, boardId: params.boardId };
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    void (async () => {
      if (!ctx) throw new Error('No Data Root');
      const id = await services.context.resolveBoard(typeof params.boardId === 'string' ? params.boardId : undefined);
      const value = await boardStats(ctx, services, id, controller.signal);
      if (!controller.signal.aborted) setData(value);
    })()
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setFailed(true);
          toast.error(error);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [ctx, services, params.boardId, refresh, toast]);
  useKeyHints([{ key: 'r', description: 'refresh stats' }]);
  useInput(
    (input) => {
      if (input === 'r') setRefresh((value) => value + 1);
    },
    { isActive: active },
  );

  // Returning data and its keys remain available during a refresh.
  if (!data)
    return loading ? (
      <Loading label="Loading Stats…" />
    ) : (
      <Text color={theme.inkMuted}>Stats unavailable. Press r to refresh.</Text>
    );
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color={theme.ink}>
        {data.board.name} · Stats
      </Text>
      <Text color={theme.inkMuted}>
        All time · current records · deleted Stories and historical transitions excluded
      </Text>
      <BoardStatsSection title="Stories" metrics={data.metrics} />
      {data.plugins.map((plugin) => (
        <BoardStatsSection key={plugin.id} title={plugin.name} metrics={plugin.metrics} />
      ))}
      {loading && <Text color={theme.inkFaint}>Refreshing…</Text>}
      {failed && <Text color={theme.danger}>Refresh failed. Previous results shown.</Text>}
    </Box>
  );
}
