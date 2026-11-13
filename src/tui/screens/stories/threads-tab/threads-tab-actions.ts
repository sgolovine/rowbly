import type { Key } from "ink";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { sendFactoryCommand } from "../../../../services/factory/factory.js";
import type { ThreadRecord } from "../../../../services/thread/thread.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { runExclusive, type ToastStore } from "../../../hooks/index.js";
import { type StageNames, threadActive, threadName, threadResumable } from "../thread-text.js";
import { toastInfo } from "../toast-info.js";
import type { Focus } from "./threads-tab-view.js";

/** The environment of the handlers of the Threads tab. */
export interface ThreadsTabEnv {
  readonly ctx: ServiceContext;
  readonly storyId: string;
  readonly stages: StageNames | undefined;
  readonly toast: ToastStore;
  readonly current: ThreadRecord | undefined;
  readonly cursor: number;
  /** True while a command waits for the factory, so that a second key sends no second command. */
  readonly sending: RefObject<boolean>;
  readonly refresh: () => void;
  readonly setFocus: Dispatch<SetStateAction<Focus>>;
  readonly setConfirm: Dispatch<SetStateAction<ThreadRecord | null>>;
  readonly setCursor: (index: number) => void;
}

type CommandType = "cancel" | "resume";

/** Sends `type` for `thread` to the factory and shows its progress, unless an earlier command has not finished. */
async function sendCommand(env: ThreadsTabEnv, type: CommandType, thread: ThreadRecord): Promise<void> {
  await runExclusive(env.sending, () => commandTask(env, type, thread));
}

async function commandTask(env: ThreadsTabEnv, type: CommandType, thread: ThreadRecord): Promise<void> {
  const name = `${env.storyId} ${threadName(thread, env.stages)}`;
  const progress = env.toast.pending(type === "cancel" ? `Interrupting ${name}…` : `Resuming ${name}…`);

  try {
    await sendFactoryCommand(type, { threadId: thread.id }, env.ctx);
    toastInfo(env.toast, type === "cancel" ? `Interrupted ${name}` : `Resumed ${name}`);
    env.refresh();
  } catch (error) {
    env.toast.error(error);
  } finally {
    env.toast.dismiss(progress);
  }
}

/** Asks before it interrupts the selected thread, if the thread is active. */
function interrupt(env: ThreadsTabEnv): void {
  if (env.current && threadActive(env.current)) {
    env.setConfirm(env.current);
  }
}

/** Resumes the selected thread, if the thread is resumable. */
function resume(env: ThreadsTabEnv): void {
  if (env.current && threadResumable(env.current)) {
    void sendCommand(env, "resume", env.current);
  }
}

/** `x` interrupts and `r` resumes, in the list and in the thread region. */
function handleActionKey(env: ThreadsTabEnv, input: string): void {
  if (input === "x") {
    interrupt(env);
  } else if (input === "r") {
    resume(env);
  }
}

/** The keys of the thread region: `tab` goes back to the list. */
export function handleThreadKey(env: ThreadsTabEnv, input: string, key: Key): void {
  if (key.ctrl || key.meta) {
    return;
  }

  if (key.tab && !key.shift) {
    env.setFocus("list");

    return;
  }

  handleActionKey(env, input);
}

/** The keys of the list: `enter` or `tab` opens the selected thread. */
export function handleListKey(env: ThreadsTabEnv, input: string, key: Key): void {
  if (key.ctrl || key.meta) {
    return;
  }

  if (env.current && (key.return || (key.tab && !key.shift))) {
    env.setFocus("thread");

    return;
  }

  handleActionKey(env, input);
}

/** A click on the selected row opens the thread, and a click on another row selects it. */
export function clickRow(env: ThreadsTabEnv, index: number): void {
  if (index === env.cursor) {
    env.setFocus("thread");

    return;
  }

  env.setCursor(index);
  env.setFocus("list");
}

/** Closes the dialog and interrupts `thread`. */
export function confirmInterrupt(env: ThreadsTabEnv, thread: ThreadRecord): void {
  env.setConfirm(null);
  void sendCommand(env, "cancel", thread);
}
