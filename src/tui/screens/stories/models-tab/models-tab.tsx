import { Box, Text } from "ink";
import { piWorkerSource } from "../../../../services/pi-runtime/pi-worker-client.js";
import { Loading, ScrollBody } from "../../../components/index.js";
import { theme } from "../../../theme.js";
import { ModelPickerModal, NO_OVERRIDE_LABEL } from "../../settings/model-picker-modal/index.js";
import { StageModelList } from "../../settings/stage-model-list/index.js";
import { openStage, saveStoryModel } from "./models-tab-actions.js";
import { storyModelItems } from "./models-tab-view.js";
import { type ModelsTabProps, useModelsTab } from "./use-models-tab.js";

/**
 * The worker model of the Story in each Stage. Each row shows the Story override, or the model that applies
 * without it and its source. The arrows select a Stage, and `enter` or a click opens the model picker. Its first
 * option, `No override`, removes the Story override. The models come from the model cache, and the Pi worker reads
 * Pi in the background only when the cache is stale or missing.
 */
export function ModelsTab({
  source = piWorkerSource(),
  ...props
}: Omit<ModelsTabProps, "source"> & Partial<Pick<ModelsTabProps, "source">>) {
  const { env, layout, settings, models, loading, task, idle } = useModelsTab({ ...props, source });

  return (
    <ScrollBody height={layout.height} active={idle}>
      <Box flexDirection="column">
        <Text color={theme.inkFaint} wrap="wrap">
          A Story override replaces the Stage model and the worker model for this Story in that Stage.
        </Text>
        {loading && <Loading label="Loading models…" />}
        <Box marginTop={1}>
          <StageModelList
            items={storyModelItems(settings.data, env.stages, env.storyId)}
            cursor={env.cursor}
            active={idle}
            clickable={idle && env.ready}
            onPick={(index) => openStage(env, index)}
          />
        </Box>
      </Box>
      {task && models && (
        <ModelPickerModal
          title={`${env.storyId} › Model › ${task.label}`}
          models={models}
          current={settings.data?.storyWorkerModels?.[env.storyId]?.[task.key]}
          defaultLabel={NO_OVERRIDE_LABEL}
          onSave={(choice) => saveStoryModel(env, task, choice)}
          onClose={() => env.setTask(null)}
        />
      )}
    </ScrollBody>
  );
}
