import type { RefObject } from "react";
import { releaseFactoryStory } from "../../../../services/factory/factory.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { runExclusive, showToast, type ToastStore } from "../../../hooks/index.js";

/** The environment of the `Force assignment` operation. */
export interface ForceAssignmentEnv {
  readonly ctx: ServiceContext;
  readonly storyId: string;
  readonly toast: ToastStore;
  /** True while a request runs, so that a second click or key does not send again. */
  readonly sending: RefObject<boolean>;
  readonly setBusy: (busy: boolean) => void;
}

/** Asks the live factory to evaluate the Story for a worker again, unless an earlier request has not finished. */
export function forceAssignment(env: ForceAssignmentEnv): Promise<void> {
  return runExclusive(env.sending, () => forceTask(env));
}

/** A request that fails shows the reason in an error toast. */
async function forceTask(env: ForceAssignmentEnv): Promise<void> {
  env.setBusy(true);

  const progress = env.toast.pending(`Forcing the assignment of ${env.storyId}…`);

  try {
    const result = await releaseFactoryStory(env.storyId, {}, env.ctx);

    showToast(env.toast, result.released ? "info" : "warning", resultText(env.storyId, result.released));
  } catch (error) {
    env.toast.error(error);
  } finally {
    env.toast.dismiss(progress);
    env.setBusy(false);
  }
}

function resultText(storyId: string, released: boolean): string {
  return released
    ? `The factory evaluates ${storyId} for a worker`
    : `No change: ${storyId} is not in a work Stage or has an active worker`;
}
