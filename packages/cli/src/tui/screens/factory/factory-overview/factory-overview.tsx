import { Text } from "ink";
import type { FactoryStatus } from "../../../../services/factory/factory.js";
import { DetailView } from "../../../components/index.js";
import { formatDateTime, theme } from "../../../theme.js";
import { hostRow, workerHosts } from "../factory-hosts.js";
import { FactoryList } from "../factory-list/index.js";
import { checksText, PHASES, providerNotice, workerModelNotice, workersText } from "../factory-modal-text.js";
import { factoryProblems, queueReason, restartText } from "../factory-status.js";

/** The props of `FactoryOverview`. */
export interface FactoryOverviewProps {
  readonly status: FactoryStatus | undefined;
  readonly live: boolean;
  /** The worker limit to show when the factory is off. */
  readonly limit: number | undefined;
  /** False after a start found no AI provider with credentials. */
  readonly provider: boolean | undefined;
  /** False when the settings have no worker model, so that the factory cannot start. */
  readonly workerModel: boolean | undefined;
  /** False when the Modal cannot start the factory process. */
  readonly canLaunch: boolean;
  readonly aiSettings: boolean;
  /** The names of the Stages by key. */
  readonly stages: Readonly<Record<string, string>>;
  /** False while a dialog or a different view has the keys; then the warnings do not take a click. */
  readonly clickable?: boolean;
  /** Opens the detail view of the warning with this key. */
  readonly onProblem?: (key: string) => void;
  /** The index of the first row in the window of the `Attention` list. */
  readonly attentionOffset?: number;
  /** Scrolls the `Attention` list by one row: `-1` up, `1` down. */
  readonly onScrollAttention?: (direction: -1 | 1) => void;
}

function failed(status: FactoryStatus | undefined): boolean {
  return status?.phase === "failed" || status?.phase === "unavailable";
}

/** The Restarts row, when the daemon crashed. */
function restartRows(status: FactoryStatus | undefined): { label: string; value: string }[] {
  const text = restartText(status);

  return text === undefined ? [] : [{ label: "Restarts", value: text }];
}

/**
 * The state of the factory, the hosts of a live factory with a worker host, the problems and the queued Stories.
 */
export function FactoryOverview({
  status,
  live,
  limit,
  provider,
  workerModel,
  canLaunch,
  aiSettings,
  stages,
  clickable = false,
  onProblem,
  attentionOffset,
  onScrollAttention,
}: FactoryOverviewProps) {
  const queue = live ? (status?.queue ?? []) : [];
  const hosts = workerHosts(status, live);
  const now = Date.now();

  return (
    <>
      <DetailView
        rows={[
          {
            label: "Status",
            value: (
              <Text color={failed(status) ? theme.danger : theme.ink}>
                {status ? PHASES[status.phase] : "…"}
                {status?.error ? <Text color={theme.inkMuted}> · {status.error}</Text> : null}
              </Text>
            ),
          },
          { label: "Workers", value: workersText(live, status?.workers, limit) },
          ...(live && status?.checks ? [{ label: "Checks", value: checksText(status.checks) }] : []),
          ...(live && status?.owner ? [{ label: "Started", value: formatDateTime(status.owner.startedAt) }] : []),
          ...restartRows(status),
        ]}
      />
      {workerModel === false && (
        <Text color={theme.inkMuted} wrap="wrap">
          {workerModelNotice(aiSettings)}
        </Text>
      )}
      {!live && provider === false && (
        <Text color={theme.inkMuted} wrap="wrap">
          {providerNotice(aiSettings)}
        </Text>
      )}
      {!live && !canLaunch && (
        <Text color={theme.inkFaint} wrap="wrap">
          Run rowbly factory start to start the factory.
        </Text>
      )}
      <FactoryList title="Hosts" rows={hosts.map((host) => ({ key: host.id, node: hostRow(host, hosts, now) }))} />
      <FactoryList
        title="Attention"
        clickable={clickable}
        offset={attentionOffset}
        onScroll={onScrollAttention}
        rows={factoryProblems(status).map((problem) => ({
          key: problem.key,
          onClick: onProblem && (() => onProblem(problem.key)),
          node: (
            <Text wrap="truncate-end">
              <Text color={theme.stageBoard}>! </Text>
              <Text color={theme.ink}>{problem.text}</Text>
            </Text>
          ),
        }))}
      />
      <FactoryList
        title="Queue"
        rows={queue.map((entry) => ({
          key: entry.story,
          node: (
            <Text wrap="truncate-end">
              <Text color={theme.accent}>{entry.story}</Text>
              <Text color={theme.inkMuted}> {stages[entry.stage] ?? entry.stage}</Text>
              <Text color={theme.inkFaint}> · </Text>
              <Text color={theme.ink}>{queueReason(entry, status?.providers)}</Text>
            </Text>
          ),
        }))}
      />
    </>
  );
}
