import { Box } from "ink";
import { authRuntime, getAuthStatus } from "../../../../services/agent-auth/agent-auth.js";
import type { FactoryLaunch, FactoryStatus } from "../../../../services/factory/factory.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { ConfirmDialog, conversationKeys, Modal } from "../../../components/index.js";
import type { KeyHint } from "../../../keymap.js";
import { FactoryButtons } from "../factory-buttons/index.js";
import { FactoryHistory } from "../factory-history/index.js";
import { factoryHints } from "../factory-modal-text.js";
import { FactoryOverview } from "../factory-overview/index.js";
import { FactorySupervisor } from "../factory-supervisor/index.js";
import { type FactoryModalModel, useFactoryModal } from "./use-factory-modal.js";

/** The frame of one view: its title, its keys and the action of the `✕` of the Modal. */
interface ViewFrame {
  readonly title: string;
  readonly hints: readonly KeyHint[];
  readonly onClose: (() => void) | undefined;
}

const HISTORY_HINTS: readonly KeyHint[] = [
  { key: "↑/↓", description: "select" },
  { key: "enter", description: "peek" },
  { key: "/", description: "filter" },
  { key: "esc", description: "back" },
];

/** True when Pi has a provider with credentials or a key. It loads Pi, so call it only on request. */
async function providerReady(): Promise<boolean> {
  return (await getAuthStatus(await authRuntime())).some((provider) => provider.configured);
}

/** The frame of the view on screen. The `✕` of the overview works only while no dialog is open. */
function modalFrame(model: FactoryModalModel, onClose: () => void, aiSettings: boolean): ViewFrame {
  if (model.view === "supervisor") {
    return {
      title: `Factory › Supervisor · ${model.supervisor?.status ?? "unavailable"}`,
      hints: [...conversationKeys(model.supervisor?.status === "running"), { key: "esc", description: "back" }],
      onClose: model.actions.closeSupervisor,
    };
  }

  if (model.view === "history") {
    return { title: "Factory › Supervisor history", hints: HISTORY_HINTS, onClose: model.actions.closeHistory };
  }

  return {
    title: "Factory",
    hints: factoryHints({ ...model.can, aiSettings }),
    onClose: model.idle ? onClose : undefined,
  };
}

/** The props of `FactoryModal`. */
interface FactoryModalProps {
  ctx: ServiceContext;
  status: FactoryStatus | undefined;
  /** The names of the Stages by key. */
  stages?: Readonly<Record<string, string>>;
  /** How to start the factory process. Without it, the Modal cannot start the factory. */
  launch?: FactoryLaunch;
  onClose(): void;
  /** Opens the AI section of Settings: providers, models and the worker limit. */
  onAiSettings?(): void;
  /** Tells if an AI provider is ready. Tests replace it, so that they do not load Pi. */
  checkProvider?: () => Promise<boolean>;
}

/**
 * The Factory controls (`f`), in a generic Modal: the state of the factory, its supervisor and workers,
 * the problems that ask for attention and the queued Stories with the reason why they wait. `s` starts the
 * factory as a process of its own, and `x` asks before it stops the factory. The factory keeps running
 * when the TUI quits. `enter` shows the conversation of the supervisor in the same Modal, and `esc` goes
 * back. `a` opens the AI settings. `status` comes from the shell, which reads it again on each change.
 */
export function FactoryModal({
  ctx,
  status,
  stages = {},
  launch,
  onClose,
  onAiSettings,
  checkProvider = providerReady,
}: FactoryModalProps) {
  const model = useFactoryModal({ ctx, status, launch, onClose, onAiSettings, checkProvider });

  const { view, live, can, idle, busy, actions } = model;
  const frame = modalFrame(model, onClose, onAiSettings !== undefined);

  return (
    <Modal title={frame.title} hints={frame.hints} onClose={frame.onClose}>
      {view === "supervisor" && model.supervisorId !== undefined && (
        <FactorySupervisor
          ctx={ctx}
          threadId={model.supervisorId}
          live={model.supervisor?.status === "running"}
          active={model.active}
          layout={model.layout}
        />
      )}
      {view === "history" && (
        <FactoryHistory
          threads={model.threads}
          supervisorId={model.supervisorId}
          height={model.layout.height}
          active={model.active}
          onFilteringChange={actions.setFiltering}
          onPick={actions.pickSupervisor}
        />
      )}
      {view === "main" && (
        <Box flexDirection="column" gap={1}>
          <FactoryOverview
            status={status}
            live={live}
            supervisor={model.supervisor}
            limit={model.limit}
            provider={model.provider}
            canLaunch={launch !== undefined}
            aiSettings={onAiSettings !== undefined}
            stages={stages}
          />
          <FactoryButtons
            live={live}
            canLaunch={launch !== undefined}
            stopping={status?.phase === "stopping"}
            busy={busy}
            canStart={can.start}
            canStop={can.stop}
            canInspect={can.inspect}
            idle={idle}
            onStart={actions.start}
            onInspect={actions.openSupervisor}
            onHistory={actions.openHistory}
            onStop={actions.askStop}
            onAiSettings={onAiSettings}
          />
        </Box>
      )}
      {view === "main" && model.confirm && (
        <ConfirmDialog
          title="Factory › Stop"
          message="Stop the factory? The workers stop. Rowbly keeps their sessions and worktrees, and a later start can resume them."
          confirmLabel="Stop"
          cancelLabel="Cancel"
          destructive
          onConfirm={actions.confirmStop}
          onCancel={actions.cancelStop}
        />
      )}
    </Modal>
  );
}
