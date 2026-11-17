import type { FactorySettings } from "../../../../services/factory-settings/factory-settings.js";
import type { Stage } from "../../../../services/stage/stage.js";
import type { KeyHint } from "../../../keymap.js";
import { modelText } from "../../settings/ai-view.js";
import type { StageModelItem } from "../../settings/stage-model-list/index.js";

/** The keys that work now: the selection with Stages, and the model picker after the models load. */
export interface ModelsTabAbilities {
  readonly stages: boolean;
  readonly ready: boolean;
}

/** The model of a Story in a Stage without its own override: the Stage override, else the worker model. */
function inheritedText(settings: FactorySettings | undefined, stage: Stage): string {
  const stageModel = settings?.stageWorkerModels?.[stage.key];

  if (stageModel) {
    return `Stage model: ${modelText(stageModel)}`;
  }

  return `Worker model: ${modelText(settings?.workerModel)}`;
}

/** One row for each Stage: the Story override for the Stage, or the model that applies without it and its source. */
export function storyModelItems(
  settings: FactorySettings | undefined,
  stages: readonly Stage[],
  storyId: string,
): StageModelItem[] {
  return stages.map((stage) => {
    const override = settings?.storyWorkerModels?.[storyId]?.[stage.key];

    return override
      ? { stage, value: modelText(override), inherited: false }
      : { stage, value: inheritedText(settings, stage), inherited: true };
  });
}

/** The keys of the Models tab that work now. */
export function modelsTabHints(can: ModelsTabAbilities): readonly KeyHint[] {
  if (!can.stages) {
    return [];
  }

  return [
    { key: "↑/↓", description: "select Stage" },
    ...(can.ready ? [{ key: "enter", description: "change model" }] : []),
  ];
}
