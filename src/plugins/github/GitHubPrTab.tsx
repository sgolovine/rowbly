import { type PluginStoryTabProps, RowblyError } from '../../plugin-api';
import {
  Box,
  DetailView,
  formatDate,
  Loading,
  relativeDate,
  Text,
  theme,
  useEffect,
  useInput,
  useIsActive,
  useKeyHints,
  useRef,
  useState,
} from '../../plugin-api/tui';
import { GitHubBag } from './model';
import { checksText, fetchStatus, type PrStatus, statusText } from './status';

/** Only this active tab owns refresh scheduling. Nothing is cached in the Data Root. */
export function GitHubPrTab({ story, plugin, active }: PluginStoryTabProps) {
  const enabled = useIsActive() && active;
  const bag = plugin.inspectBag(story, GitHubBag);
  const pr = bag.kind === 'valid' ? bag.value.pr : undefined;
  const [status, setStatus] = useState<PrStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const refresh = useRef<(() => void) | null>(null);
  useEffect(() => {
    setStatus(null);
    setError(null);
    if (!enabled || !pr || plugin.externalReadSignal.aborted) return;
    const controller = new AbortController();
    let running = false;
    const load = async () => {
      if (running || controller.signal.aborted) return;
      running = true;
      setLoading(true);
      try {
        const value = await fetchStatus(plugin, story, controller.signal);
        if (!controller.signal.aborted) {
          setStatus(value);
          setError(null);
        }
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(
            failure instanceof RowblyError
              ? `${failure.message}${failure.hint ? `: ${failure.hint}` : ''}`
              : failure instanceof Error
                ? failure.message
                : String(failure),
          );
      } finally {
        running = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    refresh.current = () => {
      void load();
    };
    const timer = setInterval(() => {
      void load();
    }, 60_000);
    const abort = () => {
      clearInterval(timer);
      controller.abort();
      refresh.current = null;
    };
    plugin.externalReadSignal.addEventListener('abort', abort, { once: true });
    void load();
    return () => {
      abort();
      plugin.externalReadSignal.removeEventListener('abort', abort);
    };
  }, [enabled, pr, plugin, story.key]);
  useKeyHints(enabled && pr ? [{ key: 'r', description: 'refresh' }] : []);
  useInput(
    (input) => {
      if (input === 'r') refresh.current?.();
    },
    { isActive: enabled && Boolean(pr) },
  );
  if (bag.kind === 'invalid')
    return (
      <Text color={theme.danger}>
        GitHub PR unavailable: stored value is invalid; kept unchanged. Repair it by hand.
      </Text>
    );
  if (!pr) return <Text color={theme.inkFaint}>No GitHub PR. Edit the Story to link one.</Text>;
  return (
    <Box flexDirection="column">
      {status && (
        <DetailView
          rows={[
            { label: 'GitHub PR', value: `#${status.number} ${status.title}` },
            { label: 'URL', value: status.url },
            { label: 'Summary', value: statusText(status) },
            { label: 'Checks', value: checksText(status.checks) },
            { label: 'Merge', value: `${status.mergeable.toLowerCase()} · ${status.mergeStateStatus.toLowerCase()}` },
            {
              label: 'Fetched',
              value: `${formatDate(status.fetchedAt)} (${relativeDate(status.fetchedAt, plugin.now())})`,
            },
          ]}
        />
      )}
      {loading && <Loading label={status ? 'Refreshing GitHub PR…' : 'Loading GitHub PR…'} />}
      {error && (
        <Text color={theme.danger}>
          {status ? 'Refresh failed; showing the last result. ' : ''}
          {error}
        </Text>
      )}
      <Text color={theme.inkFaint}>Refreshes every 60 seconds while active.</Text>
    </Box>
  );
}
