import { Box, Text } from "ink";
import type { FactorySettings } from "../../../../services/factory-settings/factory-settings.js";
import type { Stage } from "../../../../services/stage/stage.js";
import { theme } from "../../../theme.js";
import { AiSettingCard } from "../ai-setting-card/index.js";
import { modelText, type Role, stageModelItems } from "../ai-view.js";
import { StageModelList } from "../stage-model-list/index.js";

/** The props of `AiModelsPage`. */
export interface AiModelsPageProps {
  readonly settings: FactorySettings | undefined;
  /** True when Pi and the providers have loaded, so that the models can change. */
  readonly ready: boolean;
  /** False while a task on top has the keys. */
  readonly idle: boolean;
  readonly onModel: (role: Role) => void;
  /** The Stages of the Project in board order, or `undefined` before they load. */
  readonly stages?: readonly Stage[];
  /** The index of the highlighted Stage. */
  readonly stageCursor?: number;
  readonly onStage?: (index: number) => void;
}

function roleModel(settings: FactorySettings | undefined, role: Role): string {
  if (!settings) {
    return "—";
  }

  return modelText(role === "supervisor" ? settings.supervisorModel : settings.workerModel);
}

/**
 * The Models tab: the model of the supervisor and the model of the workers, each in its own card. Under them,
 * one row for each Stage shows the worker model override of the Stage.
 */
export function AiModelsPage({
  settings,
  ready,
  idle,
  onModel,
  stages = [],
  stageCursor = 0,
  onStage = () => undefined,
}: AiModelsPageProps) {
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
      {stages.length > 0 && (
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text bold color={theme.ink}>
            Stage worker models
          </Text>
          <Text color={theme.inkFaint} wrap="wrap">
            A Stage override replaces the worker model in that Stage. A Story override has priority.
          </Text>
          <Box marginTop={1}>
            <StageModelList
              items={stageModelItems(settings, stages)}
              cursor={stageCursor}
              active={idle}
              clickable={idle && ready}
              onPick={onStage}
            />
          </Box>
        </Box>
      )}
    </Box>
  );
}
