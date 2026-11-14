import type { Key } from "ink";
import type { Dispatch, SetStateAction } from "react";
import { type ModelChoice, setWorkerOverride } from "../../../../services/factory-settings/factory-settings.js";
import type { Stage } from "../../../../services/stage/stage.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { showToast, type ToastStore } from "../../../hooks/index.js";
import { moveDelta } from "../../../keymap.js";
import { modelText } from "../../settings/ai-view.js";

/** The environment of the handlers of the Models tab. */
export interface ModelsTabEnv {
  readonly ctx: ServiceContext;
  readonly storyId: string;
  readonly toast: ToastStore;
  /** The Stages of the Project in board order. */
  readonly stages: readonly Stage[];
  /** The index of the highlighted Stage. */
  readonly cursor: number;
  /** True when the models have loaded, so that the picker can open. */
  readonly ready: boolean;
  readonly setCursor: Dispatch<SetStateAction<number>>;
  /** The Stage of the open model picker, or `null` for none. */
  readonly setTask: Dispatch<SetStateAction<Stage | null>>;
  /** Reads `factory.json` again after a change. */
  readonly reload: () => void;
}

/** Selects the Stage at the index, and opens its model picker when the models have loaded. */
export function openStage(env: ModelsTabEnv, index: number): void {
  const stage = env.stages[index];

  env.setCursor(index);

  if (stage && env.ready) {
    env.setTask(stage);
  }
}

/** The arrows move the selection, and `enter` opens the model picker of the selected Stage. */
export function handleKey(env: ModelsTabEnv, input: string, key: Key): void {
  const delta = moveDelta(input, key);
  const count = env.stages.length;

  if (delta && count > 0) {
    env.setCursor((n) => Math.max(0, Math.min(count - 1, n + delta)));

    return;
  }

  if (key.return) {
    openStage(env, env.cursor);
  }
}

/** Saves the Story override for the Stage. `null` removes it, so that the Stage model or the worker model applies. */
export async function saveStoryModel(env: ModelsTabEnv, stage: Stage, choice: ModelChoice | null): Promise<void> {
  await setWorkerOverride({ stage: stage.key, storyId: env.storyId }, choice ?? undefined, env.ctx);
  showToast(
    env.toast,
    "info",
    choice
      ? `Saved the ${stage.label} model of ${env.storyId}: ${modelText(choice)}`
      : `Removed the ${stage.label} model of ${env.storyId}`,
  );
  env.setTask(null);
  env.reload();
}
