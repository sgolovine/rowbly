import type { PluginStoryTabProps } from '../../plugin-api';
import {
  Box,
  DetailView,
  formatDate,
  relativeDate,
  Text,
  theme,
  useEffect,
  useIsActive,
  useKeyHints,
  useState,
} from '../../plugin-api/tui';
import { DEFAULT_STALE_AFTER_MINUTES, liveness } from './liveness';
import { currentRun, StageRunBag } from './stageRuns';

/** How often a running Stage Run's ages refresh while the tab shows it. */
const TICK_MS = 30_000;

/** `45m`, `2h 5m`, `3d 4h`: the time between two timestamps, to the minute. */
function elapsedText(from: string, to: Date): string {
  const minutes = Math.max(0, Math.floor((to.getTime() - new Date(from).getTime()) / 60_000));
  if (minutes < 1) return 'under 1m';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
}

/**
 * The Story's Stage Run for its current visit (ADR-0040), read-only. It reads the Story it is given,
 * which the Story screen reloads, so the tab loads nothing; a running Stage Run's ages refresh on a
 * timer while the tab is shown.
 */
export function StageRunTab({ story, active, plugin }: PluginStoryTabProps) {
  const isActive = useIsActive() && active;
  useKeyHints(isActive ? [{ key: 'tab/←/→', description: 'switch tab' }] : []);
  const run = currentRun(plugin, story);
  const running = run?.status === 'running';
  const [now, setNow] = useState(() => plugin.now());
  useEffect(() => {
    setNow(plugin.now());
    if (!running) return;
    const timer = setInterval(() => setNow(plugin.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [plugin, running, story]);

  if (plugin.inspectBag(story, StageRunBag).kind === 'invalid')
    return <Text color={theme.danger}>The Stage Run is unavailable: invalid Plugin Data; run `rowbly doctor`.</Text>;
  if (!run)
    return (
      <Box flexDirection="column" gap={1}>
        <DetailView rows={[{ label: 'Stage Run', value: '—' }]} />
        <Text color={theme.inkFaint}>No Stage Run in this visit to the Story's Stage.</Text>
      </Box>
    );
  const at = (timestamp: string) => `${formatDate(timestamp)} · ${relativeDate(timestamp, now)}`;
  const seen = running ? liveness(run, null, now, DEFAULT_STALE_AFTER_MINUTES) : null;
  return (
    <DetailView
      rows={[
        {
          label: 'Outcome',
          value: <Text color={run.status === 'failed' ? theme.danger : theme.ink}>{run.status}</Text>,
        },
        { label: 'Attempt', value: String(run.attempt) },
        { label: 'Worker', value: <Text wrap="wrap">{run.worker}</Text> },
        { label: 'Started by', value: run.by ?? '—' },
        { label: 'Started', value: at(run.startedAt) },
        ...(run.finishedAt
          ? [{ label: run.status === 'failed' ? 'Failed' : 'Finished', value: at(run.finishedAt) }]
          : []),
        {
          label: running ? 'Running for' : 'Took',
          value: elapsedText(run.startedAt, run.finishedAt ? new Date(run.finishedAt) : now),
        },
        ...(seen
          ? [
              {
                label: 'Last seen',
                value: `${seen.lastSeenAt ? at(seen.lastSeenAt) : 'not reported'}${seen.stale ? ' · stale: check the worker' : ''}`,
              },
            ]
          : []),
        ...(run.reason ? [{ label: 'Reason', value: <Text wrap="wrap">{run.reason}</Text> }] : []),
      ]}
    />
  );
}
