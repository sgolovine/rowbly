import { Box, Text, useInput } from "ink";
import { type ReactNode, useRef, useState } from "react";
import { authRuntime, getAuthStatus } from "../../../../services/agentAuth/agentAuth.js";
import {
  type FactoryLaunch,
  type FactoryStatus,
  startFactory,
  stopFactory,
} from "../../../../services/factory/factory.js";
import { getFactorySettings } from "../../../../services/factorySettings/factorySettings.js";
import { getThread } from "../../../../services/thread/thread.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { Button, ConfirmDialog, DetailView, Modal } from "../../../components/index.js";
import { useAsync, useEscape, useIsActive, useKeyCapture, useToast } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { formatDateTime, theme } from "../../../theme.js";
import { factoryLive, factoryProblems, queueReason } from "../factoryStatus.js";

/** The most problems and queued Stories that the Modal lists; a `↓ n more` row follows. */
const LIST_LIMIT = 5;

/** True when Pi has a provider with credentials or a key. It loads Pi, so call it only on request. */
async function providerReady(): Promise<boolean> {
  return (await getAuthStatus(await authRuntime())).some((provider) => provider.configured);
}

/** The words of a phase for people. */
const PHASES: Record<FactoryStatus["phase"], string> = {
  starting: "Starting",
  ready: "Running",
  stopping: "Stopping",
  stopped: "Stopped",
  failed: "Failed",
  unavailable: "Unavailable",
};

/** A list with a title, cut at `LIST_LIMIT` rows. It is empty when there are no rows. */
function section(title: string, rows: readonly { key: string; node: ReactNode }[]): ReactNode {
  if (rows.length === 0) return null;
  return (
    <Box flexDirection="column">
      <Text color={theme.inkMuted}>{title}</Text>
      {rows.slice(0, LIST_LIMIT).map((row) => (
        <Box key={row.key}>{row.node}</Box>
      ))}
      {rows.length > LIST_LIMIT && <Text color={theme.inkFaint}>↓ {rows.length - LIST_LIMIT} more</Text>}
    </Box>
  );
}

/**
 * The Factory controls (`f`), in a generic Modal: the state of the factory, its supervisor and workers,
 * the problems that ask for attention and the queued Stories with the reason why they wait. `s` starts the
 * factory as a process of its own, and `x` asks before it stops the factory. The factory keeps running
 * when the TUI quits. `status` comes from the shell, which reads it again on each change.
 */
export function FactoryModal({
  ctx,
  status,
  stages = {},
  launch,
  onClose,
  checkProvider = providerReady,
}: {
  ctx: ServiceContext;
  status: FactoryStatus | undefined;
  /** The names of the Stages by key. */
  stages?: Readonly<Record<string, string>>;
  /** How to start the factory process. Without it, the Modal cannot start the factory. */
  launch?: FactoryLaunch;
  onClose(): void;
  /** Tells if an AI provider is ready. Tests replace it, so that they do not load Pi. */
  checkProvider?: () => Promise<boolean>;
}) {
  const active = useIsActive();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<"start" | "stop" | null>(null);
  const working = useRef(false);
  const live = factoryLive(status);
  const supervisorId = live ? status?.supervisorThreadId : undefined;
  const supervisor = useAsync(
    async () => (supervisorId ? getThread(supervisorId, ctx).catch(() => undefined) : undefined),
    [ctx, supervisorId],
  );
  const settings = useAsync(() => getFactorySettings(ctx), [ctx]);
  // Only a stopped factory asks Pi about providers, before a start.
  const provider = useAsync(async () => (live ? true : checkProvider().catch(() => true)), [live, checkProvider]);
  const canStart = !live && busy === null && launch !== undefined;
  const canStop = live && status?.phase !== "stopping" && busy === null;
  const idle = active && !confirm;

  const run = async (kind: "start" | "stop") => {
    if (working.current) return;
    working.current = true;
    setBusy(kind);
    const progress = toast.pending(kind === "start" ? "Starting the factory…" : "Stopping the factory…");
    try {
      if (kind === "start" && launch) await startFactory({ launch }, ctx);
      else await stopFactory({}, ctx);
      toast.push("info", kind === "start" ? "Started the factory" : "Stopped the factory");
    } catch (error) {
      toast.error(error);
    } finally {
      toast.dismiss(progress);
      working.current = false;
      setBusy(null);
    }
  };

  useKeyCapture(active, { text: false, escape: true });
  useEscape(idle, onClose);
  useInput(
    (input, key) => {
      if (key.ctrl || key.meta) return;
      if (input === "s" && canStart) void run("start");
      else if (input === "x" && canStop) setConfirm(true);
    },
    { isActive: idle },
  );

  const workers = status?.workers;
  const limit = workers?.limit ?? settings.data?.maxWorkers;
  const problems = factoryProblems(status);
  const queue = live ? (status?.queue ?? []) : [];
  const model = supervisor.data?.model;
  const hints: KeyHint[] = [
    ...(canStart ? [{ key: "s", description: "start" }] : []),
    ...(canStop ? [{ key: "x", description: "stop" }] : []),
    { key: "esc", description: "back" },
  ];
  return (
    <Modal title="Factory" hints={hints} onClose={idle ? onClose : undefined}>
      <Box flexDirection="column" gap={1}>
        <DetailView
          rows={[
            {
              label: "Status",
              value: (
                <Text color={status?.phase === "failed" || status?.phase === "unavailable" ? theme.danger : theme.ink}>
                  {status ? PHASES[status.phase] : "…"}
                  {status?.error ? <Text color={theme.inkMuted}> · {status.error}</Text> : null}
                </Text>
              ),
            },
            {
              label: "Supervisor",
              value: model ? `${model.provider}/${model.modelId}` : live ? "Pi default" : "—",
            },
            {
              label: "Workers",
              value:
                live && workers
                  ? `${workers.running} running · ${workers.pending} pending · limit ${workers.limit}`
                  : limit !== undefined
                    ? `limit ${limit}`
                    : "—",
            },
            ...(live && status?.owner ? [{ label: "Started", value: formatDateTime(status.owner.startedAt) }] : []),
          ]}
        />
        {!live && provider.data === false && (
          <Text color={theme.inkMuted} wrap="wrap">
            No AI provider is signed in. Sign in with rowbly auth login before you start the factory.
          </Text>
        )}
        {!live && launch === undefined && (
          <Text color={theme.inkFaint} wrap="wrap">
            Run rowbly factory start to start the factory.
          </Text>
        )}
        {section(
          "Attention",
          problems.map((problem) => ({
            key: problem.key,
            node: (
              <Text wrap="truncate-end">
                <Text color={theme.stageBoard}>! </Text>
                <Text color={theme.ink}>{problem.text}</Text>
              </Text>
            ),
          })),
        )}
        {section(
          "Queue",
          queue.map((entry) => ({
            key: entry.story,
            node: (
              <Text wrap="truncate-end">
                <Text color={theme.accent}>{entry.story}</Text>
                <Text color={theme.inkMuted}> {stages[entry.stage] ?? entry.stage}</Text>
                <Text color={theme.inkFaint}> · </Text>
                <Text color={theme.ink}>{queueReason(entry)}</Text>
              </Text>
            ),
          })),
        )}
        <Box flexWrap="wrap" gap={1}>
          {!live && launch !== undefined && (
            <Button
              label={busy === "start" ? "Start…" : "Start"}
              keyName="s"
              busy={busy === "start"}
              compact
              clickable={idle && canStart}
              onClick={() => void run("start")}
            />
          )}
          {live && (
            <Button
              label={busy === "stop" || status?.phase === "stopping" ? "Stop…" : "Stop"}
              keyName="x"
              busy={!canStop}
              destructive={canStop}
              compact
              clickable={idle && canStop}
              onClick={() => setConfirm(true)}
            />
          )}
        </Box>
      </Box>
      {confirm && (
        <ConfirmDialog
          title="Factory › Stop"
          message="Stop the factory? The workers stop. Rowbly keeps their sessions and worktrees, and a later start can resume them."
          confirmLabel="Stop"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => {
            setConfirm(false);
            void run("stop");
          }}
          onCancel={() => setConfirm(false)}
        />
      )}
    </Modal>
  );
}
