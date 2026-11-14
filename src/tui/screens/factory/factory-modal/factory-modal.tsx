import { authRuntime, getAuthStatus } from "../../../../services/agent-auth/agent-auth.js";
import type { FactoryLaunch, FactoryStatus } from "../../../../services/factory/factory.js";
import type { Story } from "../../../../services/story/story.js";
import type { ThreadRecord } from "../../../../services/thread/thread.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { ConfirmDialog, Modal } from "../../../components/index.js";
import { FactoryHistory } from "../factory-history/index.js";
import { FactoryMain } from "../factory-main/index.js";
import { FactorySupervisor } from "../factory-supervisor/index.js";
import { FactoryWarnings } from "../factory-warnings/index.js";
import { modalFrame } from "./factory-modal-frame.js";
import { type FactoryModalInput, useFactoryModal } from "./use-factory-modal.js";

/** True when Pi has a provider with credentials or a key. It loads Pi, so call it only on request. */
async function providerReady(): Promise<boolean> {
  return (await getAuthStatus(await authRuntime())).some((provider) => provider.configured);
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
  /** The Stories of the board, to show the Story of a warning. */
  stories?: readonly Story[];
  /** Closes the Modal and opens the Story of a warning in the Story sidebar. */
  onOpenStory?(story: Story): void;
  /** Opens the related Thread of a warning in the Story sidebar. */
  onOpenThread?(thread: ThreadRecord): void;
}

const NO_STORIES: readonly Story[] = [];

/** The inputs of the hook, with the defaults of the optional props. */
function modalInput(props: FactoryModalProps): FactoryModalInput {
  return {
    ...props,
    launch: props.launch,
    onAiSettings: props.onAiSettings,
    checkProvider: props.checkProvider ?? providerReady,
    stories: props.stories ?? NO_STORIES,
    onOpenStory: props.onOpenStory,
    onOpenThread: props.onOpenThread,
  };
}

/**
 * The Factory controls (`f`), in a generic Modal: the state of the factory, its supervisor and workers,
 * the problems that ask for attention and the queued Stories with the reason why they wait. `s` starts the
 * factory as a process of its own, and `x` asks before it stops the factory. The factory keeps running
 * when the TUI quits. `enter` shows the conversation of the supervisor in the same Modal, and `esc` goes
 * back. `w` lists the warnings, and `enter` or a click on a warning shows its full text, its Story and its
 * Thread. `d` dismisses an attention entry of the live factory. `a` opens the AI settings. `status` comes
 * from the shell, which reads it again on each change.
 */
export function FactoryModal(props: FactoryModalProps) {
  const { ctx, status, stages = {}, launch, onClose, onAiSettings } = props;
  const model = useFactoryModal(modalInput(props));

  const { view, actions } = model;
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
      {(view === "attention" || view === "problem") && (
        <FactoryWarnings attention={model.attention} height={model.layout.height} active={model.active} />
      )}
      {view === "main" && (
        <FactoryMain
          model={model}
          status={status}
          canLaunch={launch !== undefined}
          stages={stages}
          onAiSettings={onAiSettings}
        />
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
