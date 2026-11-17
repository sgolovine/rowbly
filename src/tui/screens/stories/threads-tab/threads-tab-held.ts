// The keys `a` and `d` of the Threads tab: apply or discard the held entries of an abandoned remote Thread. The service
// takes the Project write lock; the factory does not need to run.

import { type HeldActionResult, heldAction } from "../../../../services/outbox-apply/held-actions.js";
import { isAbandoned, type ThreadRecord } from "../../../../services/thread/thread.js";
import { runExclusive, showToast } from "../../../hooks/index.js";
import { threadName } from "../thread-text.js";
import type { ThreadsTabEnv } from "./threads-tab-env.js";

type HeldKind = "apply" | "discard";

/** True when `thread` is abandoned and has at least one held entry. */
export function hasHeld(thread: ThreadRecord | undefined, held: Readonly<Record<string, number>>): boolean {
  return thread !== undefined && isAbandoned(thread) && (held[thread.id] ?? 0) > 0;
}

/** Gives `1 entry` or `<n> entries`. */
function entries(count: number): string {
  return count === 1 ? "1 held entry" : `${count} held entries`;
}

/** The toast text of a completed held action. */
function resultText(result: HeldActionResult, name: string): string {
  if (result.action === "apply") {
    const conflicts = result.conflicts.length;

    return `Applied ${entries(result.applied.length)} of ${name} · ${conflicts} ${conflicts === 1 ? "conflict" : "conflicts"}`;
  }

  return result.action === "discard" ? `Discarded ${entries(result.discarded)} of ${name}` : name;
}

/** True when the apply left entries with a conflict. */
function hasConflicts(result: HeldActionResult): boolean {
  return result.action === "apply" && result.conflicts.length > 0;
}

async function heldTask(env: ThreadsTabEnv, kind: HeldKind, thread: ThreadRecord): Promise<void> {
  const name = `${env.storyId} ${threadName(thread, env.stages)}`;
  const progress = env.toast.pending(kind === "apply" ? `Applying the held entries of ${name}…` : `Discarding…`);

  try {
    const result = await heldAction({ id: thread.id, [kind]: true }, env.ctx);

    showToast(env.toast, hasConflicts(result) ? "warning" : "info", resultText(result, name));
    env.refresh();
  } catch (error) {
    env.toast.error(error);
  } finally {
    env.toast.dismiss(progress);
  }
}

/** Applies or discards the held entries of `thread`, unless an earlier action has not finished. */
async function runHeld(env: ThreadsTabEnv, kind: HeldKind, thread: ThreadRecord): Promise<void> {
  await runExclusive(env.sending, () => heldTask(env, kind, thread));
}

/** `a`: applies the held entries of the selected Thread, if it is abandoned and has held entries. */
export function applyHeld(env: ThreadsTabEnv): void {
  if (env.current && hasHeld(env.current, env.held)) {
    void runHeld(env, "apply", env.current);
  }
}

/** `d`: asks before it discards the held entries of the selected Thread, if it is abandoned and has held entries. */
export function askDiscard(env: ThreadsTabEnv): void {
  if (env.current && hasHeld(env.current, env.held)) {
    env.setDiscard(env.current);
  }
}

/** Closes the dialog and discards the held entries of `thread`. */
export function confirmDiscard(env: ThreadsTabEnv, thread: ThreadRecord): void {
  env.setDiscard(null);
  void runHeld(env, "discard", thread);
}
