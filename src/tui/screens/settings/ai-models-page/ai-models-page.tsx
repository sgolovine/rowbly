import { Box } from "ink";
import type { FactorySettings } from "../../../../services/factory-settings/factory-settings.js";
import { AiSettingCard } from "../ai-setting-card/index.js";
import { modelText, type Role } from "../ai-view.js";

/** The props of `AiModelsPage`. */
export interface AiModelsPageProps {
  readonly settings: FactorySettings | undefined;
  /** True when Pi and the providers have loaded, so that the models can change. */
  readonly ready: boolean;
  /** False while a task on top has the keys. */
  readonly idle: boolean;
  readonly onModel: (role: Role) => void;
}

function roleModel(settings: FactorySettings | undefined, role: Role): string {
  if (!settings) {
    return "—";
  }

  return modelText(role === "supervisor" ? settings.supervisorModel : settings.workerModel);
}

/** The Models tab: the model of the supervisor and the model of the workers, each in its own card. */
export function AiModelsPage({ settings, ready, idle, onModel }: AiModelsPageProps) {
  const action = ready ? "Change" : undefined;

  return (
    <Box flexDirection="column">
      <AiSettingCard
        title="Supervisor model"
        value={roleModel(settings, "supervisor")}
        description="The supervisor reads the board and assigns workers to Stories."
        action={action}
        keyName="s"
        clickable={idle}
        onEdit={() => onModel("supervisor")}
      />
      <AiSettingCard
        title="Worker model"
        value={roleModel(settings, "worker")}
        description="Each worker does the work of one Story in its Stage."
        action={action}
        keyName="w"
        clickable={idle}
        onEdit={() => onModel("worker")}
      />
    </Box>
  );
}
