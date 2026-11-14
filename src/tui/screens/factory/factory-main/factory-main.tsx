import { Box } from "ink";
import type { FactoryStatus } from "../../../../services/factory/factory.js";
import { FactoryButtons } from "../factory-buttons/index.js";
import type { FactoryModalModel } from "../factory-modal/use-factory-modal.js";
import { FactoryOverview } from "../factory-overview/index.js";

/** The props of `FactoryMain`. */
export interface FactoryMainProps {
  readonly model: FactoryModalModel;
  readonly status: FactoryStatus | undefined;
  /** False when the Modal cannot start the factory process. */
  readonly canLaunch: boolean;
  /** The names of the Stages by key. */
  readonly stages: Readonly<Record<string, string>>;
  readonly onAiSettings: (() => void) | undefined;
}

/** The main view of the Factory controls: the overview of the factory and its buttons. */
export function FactoryMain({ model, status, canLaunch, stages, onAiSettings }: FactoryMainProps) {
  const { live, can, idle, busy, actions, attention } = model;

  return (
    <Box flexDirection="column" gap={1}>
      <FactoryOverview
        status={status}
        live={live}
        supervisor={model.supervisor}
        limit={model.limit}
        provider={model.provider}
        canLaunch={canLaunch}
        aiSettings={onAiSettings !== undefined}
        stages={stages}
        clickable={idle}
        onProblem={attention.actions.pick}
      />
      <FactoryButtons
        live={live}
        canLaunch={canLaunch}
        stopping={status?.phase === "stopping"}
        busy={busy}
        canStart={can.start}
        canStop={can.stop}
        canInspect={can.inspect}
        canWarnings={can.warnings}
        idle={idle}
        onStart={actions.start}
        onInspect={actions.openSupervisor}
        onWarnings={attention.actions.openList}
        onHistory={actions.openHistory}
        onStop={actions.askStop}
        onAiSettings={onAiSettings}
      />
    </Box>
  );
}
