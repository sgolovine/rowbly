import type { Key } from "ink";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { dismissFactoryAttention } from "../../../../services/factory/factory.js";
import type { Story } from "../../../../services/story/story.js";
import type { ThreadRecord } from "../../../../services/thread/thread.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { runExclusive, showToast, type ToastStore } from "../../../hooks/index.js";
import type { FactoryProblem } from "../factory-status.js";

/** What the actions of the Attention views read and change. */
export interface AttentionEnv {
  readonly ctx: ServiceContext;
  readonly toast: ToastStore;
  /** The warning of the detail view. */
  readonly problem: FactoryProblem | undefined;
  readonly story: Story | undefined;
  readonly thread: ThreadRecord | undefined;
  /** True while a dismiss waits for the factory, so that a second key press sends no second command. */
  readonly dismissing: RefObject<boolean>;
  readonly setBusy: Dispatch<SetStateAction<boolean>>;
  readonly setProblemKey: Dispatch<SetStateAction<string | undefined>>;
  readonly onOpenStory: ((story: Story) => void) | undefined;
  readonly onOpenThread: ((thread: ThreadRecord) => void) | undefined;
}

/** Opens the Story of the warning in the Story sidebar, if the board has the Story. */
export function openProblemStory(env: AttentionEnv): void {
  if (env.story && env.onOpenStory) {
    env.onOpenStory(env.story);
  }
}

/** Opens the related Thread of the warning in the Thread Modal, if it has one. */
export function openProblemThread(env: AttentionEnv): void {
  if (env.thread && env.onOpenThread) {
    env.onOpenThread(env.thread);
  }
}

/** Asks the daemon to remove the attention entry of the warning, unless an earlier dismiss has not finished. */
export async function dismissProblem(env: AttentionEnv): Promise<void> {
  const { problem } = env;

  if (!problem?.dismissible || problem.attentionKey === undefined) {
    return;
  }

  await runExclusive(env.dismissing, () => dismissTask(env, problem.key, problem.attentionKey ?? ""));
}

/** A dismiss that fails keeps the warning and shows the error. A dismiss that completes goes back to the list. */
async function dismissTask(env: AttentionEnv, key: string, attentionKey: string): Promise<void> {
  env.setBusy(true);

  const progress = env.toast.pending("Dismissing the warning…");

  try {
    await dismissFactoryAttention(attentionKey, {}, env.ctx);
    showToast(env.toast, "info", "Dismissed the warning");
    env.setProblemKey((current) => (current === key ? undefined : current));
  } catch (error) {
    env.toast.error(error);
  } finally {
    env.toast.dismiss(progress);
    env.setBusy(false);
  }
}

/** The keys of the detail view: `o` opens the Story, `t` opens the Thread and `d` dismisses the warning. */
export function handleProblemKey(env: AttentionEnv, input: string, key: Key): void {
  if (key.ctrl || key.meta) {
    return;
  }

  if (input === "o") {
    openProblemStory(env);

    return;
  }

  if (input === "t") {
    openProblemThread(env);

    return;
  }

  if (input === "d") {
    void dismissProblem(env);
  }
}
