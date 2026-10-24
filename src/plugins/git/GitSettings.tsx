import type { GitSyncStatus, PluginScreenProps } from '../../plugin-api';
import {
  Box,
  Button,
  DetailView,
  formatDate,
  Loading,
  Text,
  theme,
  useAsync,
  useEffect,
  useInput,
  useIsActive,
  useKeyHints,
  useRef,
  useReloadOnReturn,
  useState,
} from '../../plugin-api/tui';
import { preferences, resolveSyncOptions } from './model';

export function GitSettings({ plugin, ui }: PluginScreenProps) {
  const active = useIsActive();
  const [requesting, setRequesting] = useState(false);
  const previous = useRef<{ prefs: Awaited<ReturnType<typeof preferences>>; sync: GitSyncStatus }>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const loaded = useAsync(
    async () => ({ prefs: await preferences(plugin), sync: await plugin.git.syncStatus(resolveSyncOptions) }),
    [plugin],
  );
  useReloadOnReturn(loaded.reload);
  useEffect(() => {
    if (!active || loaded.loading) return;
    const timer = setTimeout(loaded.reload, 1000);
    return () => clearTimeout(timer);
  }, [active, loaded.loading, loaded.reload]);
  const data = loaded.data ?? previous.current;
  useEffect(() => {
    if (loaded.data) previous.current = loaded.data;
  }, [loaded.data]);
  const busy = !!data?.sync.active || !!data?.sync.requested || requesting;
  const canRun = active && data?.sync.enabled === true && !busy;
  const run = () => {
    if (!canRun) return;
    setRequesting(true);
    void plugin.git
      .requestSync(resolveSyncOptions)
      .then((result) => {
        if (!mounted.current) return;
        if (result.active) ui.toast(`Synchronization running: ${result.active.phase}`);
        else if (result.requested) ui.toast('Synchronization pending');
        else if (result.last?.kind === 'synchronized') ui.toast('Synchronized with upstream');
        else if (result.last) ui.error(new Error(result.last.message));
        else ui.toast('No synchronization admitted');
      })
      .catch((error: unknown) => {
        if (mounted.current) ui.error(error);
      })
      .finally(() => {
        if (!mounted.current) return;
        setRequesting(false);
        loaded.reload();
      });
  };
  useKeyHints(
    data
      ? [
          { key: 'e', description: 'edit Automatic Commits' },
          { key: 'm', description: 'edit merge preferences' },
          ...(canRun ? [{ key: 'r', description: 'run now' }] : []),
        ]
      : [],
  );
  useInput(
    (input) => {
      if (input === 'e') ui.open('commits');
      if (input === 'm') ui.open('synchronization');
      if (input === 'r') run();
    },
    { isActive: active && !!data },
  );
  if (!data)
    return loaded.loading ? (
      <Loading label="Loading Git settings…" />
    ) : (
      <Text color={theme.danger}>Could not load Git settings.</Text>
    );
  const { prefs, sync } = data;
  const date = (time: number | undefined) => (time ? formatDate(new Date(time).toISOString()) : '—');
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Automatic Commits</Text>
      <DetailView
        rows={[
          { label: 'Automatic Commits', value: prefs.automaticCommits ? 'On' : 'Off' },
          {
            label: 'Frequency',
            value:
              prefs.frequency === 'change' ? 'Whenever a change is made' : `Every ${prefs.intervalSeconds} seconds`,
          },
        ]}
      />
      <Button label="Edit Automatic Commits" keyName="e" clickable={active} onClick={() => ui.open('commits')} />
      <Text bold>Automatic Merge Conflict Resolution</Text>
      <Box flexDirection="column">
        <Button
          label="Edit merge preferences"
          keyName="m"
          clickable={active}
          onClick={() => ui.open('synchronization')}
        />
        <Button
          label={!sync.enabled ? 'Run now (Off)' : busy ? 'Run now (busy)' : 'Run now'}
          keyName={sync.enabled && !busy ? 'r' : undefined}
          clickable={!!canRun}
          onClick={run}
        />
      </Box>
      <DetailView
        rows={[
          { label: 'Enabled', value: sync.enabled ? 'On' : 'Off' },
          { label: 'Merge interval', value: `${sync.intervalSeconds} seconds` },
          { label: 'Branch', value: sync.branch ?? '—' },
          { label: 'Upstream', value: sync.upstream ?? '—' },
          ...(sync.prerequisite ? [{ label: 'Prerequisite', value: sync.prerequisite }] : []),
          { label: 'Next run', value: sync.enabled ? date(sync.nextDue) : 'Paused' },
          { label: 'Active run', value: sync.active?.phase ?? (requesting || sync.requested ? 'Pending' : '—') },
          { label: 'Last attempt', value: date(sync.active?.startedAt ?? sync.last?.startedAt) },
          { label: 'Last result', value: sync.last ? `${sync.last.kind}: ${sync.last.message}` : '—' },
          { label: 'Finished', value: date(sync.last?.finishedAt) },
          { label: 'Local commit', value: sync.last?.commit?.slice(0, 12) ?? '—' },
          { label: 'Repairs', value: String(sync.last?.repairs ?? 0) },
          {
            label: 'Evidence',
            value: sync.last?.evidence.length ? sync.last.evidence.join('\n') : '—',
          },
        ]}
      />
      <Text color={theme.inkMuted}>
        Runs while Rowbly is open, including outside settings. One overdue run resumes next time; no daemon.
      </Text>
      <Text color={theme.inkMuted}>Off stops future runs. An admitted run may finish, including push.</Text>
    </Box>
  );
}
