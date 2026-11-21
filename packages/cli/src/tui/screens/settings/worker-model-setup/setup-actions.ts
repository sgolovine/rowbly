import type { Dispatch, SetStateAction } from "react";
import { type ModelChoice, updateFactorySettings } from "../../../../services/factory-settings/factory-settings.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { showToast, type ToastStore } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { modelText } from "../ai-view.js";

/** The environment of the handlers of the worker model setup. */
export interface SetupEnv {
  readonly ctx: ServiceContext;
  readonly toast: ToastStore;
  /** True when a signed-in provider has models, so that the picker can open. */
  readonly ready: boolean;
  readonly setPicking: Dispatch<SetStateAction<boolean>>;
  readonly onClose: () => void;
  readonly onAiSettings: () => void;
}

/** The text of the warning toast after a skip. */
const SKIP_TEXT = "The factory does not start without a worker model. Select it later in Settings › AI.";

/** Opens the model picker when the models have loaded. */
export function openPicker(env: SetupEnv): void {
  if (env.ready) {
    env.setPicking(true);
  }
}

/** Saves the worker model of the Project, and closes the setup. The picker cannot give `null`. */
export async function saveSetupModel(env: SetupEnv, choice: ModelChoice | null): Promise<void> {
  if (!choice) {
    return;
  }

  await updateFactorySettings({ workerModel: choice }, env.ctx);
  showToast(env.toast, "info", `Saved the worker model: ${modelText(choice)}`);
  env.onClose();
}

/** Closes the setup without a model. The board works, but the factory does not start. */
export function skipSetup(env: SetupEnv): void {
  showToast(env.toast, "warning", SKIP_TEXT);
  env.onClose();
}

/** `w` opens the model picker, and `a` opens the AI section of Settings. */
export function handleSetupKey(env: SetupEnv, input: string): void {
  if (input === "w") {
    openPicker(env);

    return;
  }

  if (input === "a") {
    env.onAiSettings();
  }
}

/** The keys of the setup. `w` shows only when the picker can open. */
export function setupHints(ready: boolean): KeyHint[] {
  return [
    ...(ready ? [{ key: "w", description: "select model" }] : []),
    { key: "a", description: "AI settings" },
    { key: "esc", description: "later" },
  ];
}
