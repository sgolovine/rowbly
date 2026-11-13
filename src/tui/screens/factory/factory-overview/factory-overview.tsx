import { Text } from "ink";
import type { FactoryStatus } from "../../../../services/factory/factory.js";
import type { ThreadRecord } from "../../../../services/thread/thread.js";
import { DetailView } from "../../../components/index.js";
import { formatDateTime, theme } from "../../../theme.js";
import { FactoryList } from "../factory-list/index.js";
import { PHASES, providerNotice, supervisorText, workersText } from "../factory-modal-text.js";
import { factoryProblems, queueReason } from "../factory-status.js";

/** The props of `FactoryOverview`. */
export interface FactoryOverviewProps {
  readonly status: FactoryStatus | undefined;
  readonly live: boolean;
  readonly supervisor: ThreadRecord | undefined;
  /** The worker limit to show when the factory is off. */
  readonly limit: number | undefined;
  /** False after a start found no AI provider with credentials. */
  readonly provider: boolean | undefined;
  /** False when the Modal cannot start the factory process. */
  readonly canLaunch: boolean;
  readonly aiSettings: boolean;
  /** The names of the Stages by key. */
  readonly stages: Readonly<Record<string, string>>;
}

function failed(status: FactoryStatus | undefined): boolean {
  return status?.phase === "failed" || status?.phase === "unavailable";
}

/** The state of the factory and its supervisor, the problems and the queued Stories. */
export function FactoryOverview({
  status,
  live,
  supervisor,
  limit,
  provider,
  canLaunch,
  aiSettings,
  stages,
}: FactoryOverviewProps) {
  const queue = live ? (status?.queue ?? []) : [];

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
          { label: "Supervisor", value: supervisorText(supervisor?.model, live) },
          { label: "Workers", value: workersText(live, status?.workers, limit) },
          ...(live && status?.owner ? [{ label: "Started", value: formatDateTime(status.owner.startedAt) }] : []),
        ]}
      />
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
      <FactoryList
        title="Attention"
        rows={factoryProblems(status).map((problem) => ({
          key: problem.key,
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
              <Text color={theme.ink}>{queueReason(entry)}</Text>
            </Text>
          ),
        }))}
      />
    </>
  );
}
