import type { Key } from "ink";
import { sendFactoryCommand } from "../../../../services/factory/factory.js";
import type { ThreadRecord } from "../../../../services/thread/thread.js";
import { runExclusive, showToast } from "../../../hooks/index.js";
import { threadActive, threadName, threadResumable } from "../thread-text.js";
import type { ThreadsTabEnv } from "./threads-tab-env.js";
import { applyHeld, askDiscard } from "./threads-tab-held.js";

export type { ThreadsTabEnv } from "./threads-tab-env.js";

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
    showToast(env.toast, "info", type === "cancel" ? `Interrupted ${name}` : `Resumed ${name}`);
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

/** Gives the focus to the steering input, if the selected thread runs. */
function focusSteer(env: ThreadsTabEnv): void {
  if (env.current?.status === "running") {
    env.setFocus("steer");
  }
}

/**
 * `x` interrupts and `r` resumes, in the list and in the thread region. `a` applies and `d` discards the held entries
 * of an abandoned thread.
 */
function handleActionKey(env: ThreadsTabEnv, input: string): void {
  if (input === "x") {
    interrupt(env);
  } else if (input === "r") {
    resume(env);
  } else if (input === "a") {
    applyHeld(env);
  } else if (input === "d") {
    askDiscard(env);
  }
}

/** The keys of the thread region: `tab` goes back to the list, `m` focuses the steering input, and `ctrl+f` opens the conversation full screen. */
export function handleThreadKey(env: ThreadsTabEnv, input: string, key: Key): void {
  if (key.ctrl && input === "f") {
    env.openFullScreen?.();

    return;
  }

  if (key.ctrl || key.meta) {
    return;
  }

  if (key.tab && !key.shift) {
    env.setFocus("list");

    return;
  }

  if (input === "m") {
    focusSteer(env);

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
