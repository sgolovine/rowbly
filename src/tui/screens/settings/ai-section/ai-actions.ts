import type { Key } from "ink";
import type { Dispatch, SetStateAction } from "react";
import {
  type AuthRuntime,
  getAuthStatus,
  listAvailableModels,
  logoutProvider,
} from "../../../../services/agent-auth/agent-auth.js";
import { ValidationError } from "../../../../services/errors/errors.js";
import {
  type FactorySettings,
  type ModelChoice,
  setWorkerOverride,
  updateFactorySettings,
} from "../../../../services/factory-settings/factory-settings.js";
import type { Stage } from "../../../../services/stage/stage.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import type { FormValues } from "../../../components/index.js";
import { type AsyncState, showToast, type ToastStore } from "../../../hooks/index.js";
import { moveDelta } from "../../../keymap.js";
import { type AiPage, type AiProvider, type AiStatus, type AiTask, modelText, nextTab, type Role } from "../ai-view.js";

/** What the handlers of the AI settings read and change. */
export interface AiEnv {
  readonly ctx: ServiceContext;
  readonly toast: ToastStore;
  readonly runtime: AsyncState<AuthRuntime>;
  readonly status: AsyncState<AiStatus | undefined>;
  readonly settings: AsyncState<FactorySettings>;
  /** The Stages of the Project in board order, for the Stage worker models. */
  readonly stages: AsyncState<readonly Stage[]>;
  /** The index of the highlighted Stage on the Models tab. */
  readonly stageCursor: number;
  readonly setStageCursor: Dispatch<SetStateAction<number>>;
  /** The index of the highlighted check on the Checks tab. */
  readonly checkCursor: number;
  readonly setCheckCursor: Dispatch<SetStateAction<number>>;
  /** The providers of the page. */
  readonly providers: readonly AiProvider[];
  readonly page: AiPage;
  readonly ready: boolean;
  readonly canSignOut: boolean;
  readonly setPage: Dispatch<SetStateAction<AiPage>>;
  readonly setTask: Dispatch<SetStateAction<AiTask>>;
  readonly setSelected: Dispatch<SetStateAction<string | undefined>>;
  readonly onChange: () => void;
}

/** Reads the providers and the models. Without a runtime, there is nothing to read. */
export async function loadStatus(runtime: AuthRuntime | undefined): Promise<AiStatus | undefined> {
  if (!runtime) {
    return undefined;
  }

  const [providers, models] = await Promise.all([getAuthStatus(runtime), listAvailableModels(runtime)]);

  return { providers, models };
}

/** Loads Pi again, and the settings with it. */
export function reloadAll(env: AiEnv): void {
  env.runtime.reload();
  env.settings.reload();
  env.stages.reload();
}

/** Closes the task. A change reads the providers and the settings again, also behind Settings. */
export function finishTask(env: AiEnv, changed: boolean): void {
  env.setTask(null);

  if (changed) {
    env.status.reload();
    env.settings.reload();
    env.onChange();
  }
}

/** Closes the sign-in. A completed sign-in goes back to the signed-in providers, where the new one shows. */
export function finishSignIn(env: AiEnv, signedIn: boolean): void {
  finishTask(env, signedIn);

  if (signedIn) {
    openPage(env, "providers");
  }
}

/** Saves the model of a role. `null` clears it, so that Pi selects its default. */
export async function saveModel(env: AiEnv, role: Role, choice: ModelChoice | null): Promise<void> {
  await updateFactorySettings({ [`${role}Model`]: choice ?? undefined }, env.ctx);
  showToast(env.toast, "info", `Saved the ${role} model: ${modelText(choice ?? undefined)}`);
  finishTask(env, true);
}

/** Saves the worker model override of a Stage. `null` removes the override, so that the worker model applies. */
export async function saveStageModel(env: AiEnv, stage: Stage, choice: ModelChoice | null): Promise<void> {
  await setWorkerOverride({ stage: stage.key }, choice ?? undefined, env.ctx);
  showToast(
    env.toast,
    "info",
    choice ? `Saved the ${stage.label} worker model: ${modelText(choice)}` : `Removed the ${stage.label} worker model`,
  );
  finishTask(env, true);
}

/** Opens the model picker of the Stage at the index, when Pi has loaded. */
export function openStageModel(env: AiEnv, index: number): void {
  const stage = env.stages.data?.[index];

  env.setStageCursor(index);

  if (stage && env.ready) {
    env.setTask({ kind: "stageModel", stage });
  }
}

/** Saves the worker limit: a whole number from one. */
export async function saveLimit(env: AiEnv, values: FormValues): Promise<void> {
  const maxWorkers = values.maxWorkers;

  if (typeof maxWorkers !== "number" || !Number.isSafeInteger(maxWorkers) || maxWorkers < 1) {
    throw new ValidationError("Invalid worker limit", {
      details: { issues: [{ path: ["maxWorkers"], message: "must be a whole number from 1" }] },
    });
  }

  await updateFactorySettings({ maxWorkers }, env.ctx);
  showToast(env.toast, "info", `Saved the worker limit: ${maxWorkers}`);
  finishTask(env, true);
}

/** Removes the stored credential of a provider. A failure closes the dialog and shows the error. */
export function signOut(env: AiEnv, id: string): void {
  if (!env.runtime.data) {
    return;
  }

  logoutProvider(env.runtime.data, id).then(
    () => signedOut(env, id),
    (error: unknown) => signOutFailed(env, error),
  );
}

function signedOut(env: AiEnv, id: string): void {
  showToast(env.toast, "info", `Signed out of ${id}`);
  finishTask(env, true);
}

function signOutFailed(env: AiEnv, error: unknown): void {
  env.toast.error(error);
  env.setTask(null);
}

/** Opens a page. The highlight starts again on the first provider of the page. */
export function openPage(env: AiEnv, page: AiPage): void {
  env.setSelected(undefined);
  env.setPage(page);
}

/** Selects a provider from the list. A provider with a sign-in method starts it. */
export function pickProvider(env: AiEnv, id: string): void {
  const chosen = env.providers.find((p) => p.id === id);

  env.setSelected(id);

  if (chosen && chosen.methods.length > 0) {
    env.setTask({ kind: "signIn" });
  }
}

/**
 * The keys of the AI settings. `←/→` change the tab. `s`, `w` and `l` work on each page, so that the keys of
 * the earlier screen stay. The list of the sign-in page takes `enter`: its `onSelect` starts the sign-in.
 */
export function handleAiKey(env: AiEnv, input: string, key: Key): void {
  if (key.ctrl || key.meta) {
    return;
  }

  if ((key.leftArrow || key.rightArrow) && env.page !== "addProvider") {
    openPage(env, nextTab(env.page, key.leftArrow ? -1 : 1));

    return;
  }

  if ((input === "s" || input === "w") && env.ready) {
    env.setTask({ kind: "model", role: input === "s" ? "supervisor" : "worker" });

    return;
  }

  if (env.page === "providers") {
    handleProvidersKey(env, input);
  }

  if (env.page === "models") {
    handleModelsKey(env, input, key);
  }

  handleOtherKey(env, input);
}

function handleProvidersKey(env: AiEnv, input: string): void {
  if (input === "d" && env.canSignOut) {
    env.setTask({ kind: "signOut" });

    return;
  }

  if (input === "n" && env.ready) {
    openPage(env, "addProvider");
  }
}

/** `↑/↓` select a Stage of the Models tab, and `enter` opens the model picker of the Stage. */
function handleModelsKey(env: AiEnv, input: string, key: Key): void {
  const count = env.stages.data?.length ?? 0;
  const delta = moveDelta(input, key);

  if (delta && count > 0) {
    env.setStageCursor((n) => Math.max(0, Math.min(count - 1, n + delta)));

    return;
  }

  if (key.return) {
    openStageModel(env, env.stageCursor);
  }
}

function handleOtherKey(env: AiEnv, input: string): void {
  if (input === "l") {
    env.setTask({ kind: "limit" });

    return;
  }

  if (input === "r") {
    reloadAll(env);
  }
}
