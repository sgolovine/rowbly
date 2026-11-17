import type { ThreadRecord } from "../../../../services/thread/thread.js";
import { ConfirmDialog } from "../../../components/index.js";
import { type StageNames, threadName } from "../thread-text.js";
import { confirmInterrupt } from "./threads-tab-actions.js";
import type { ThreadsTabEnv } from "./threads-tab-env.js";
import { confirmDiscard } from "./threads-tab-held.js";

/** The props of `ThreadsTabDialogs`. */
export interface ThreadsTabDialogsProps {
  readonly env: ThreadsTabEnv;
  readonly storyId: string;
  readonly stages: StageNames | undefined;
  /** The thread of the open interrupt confirmation. */
  readonly confirm: ThreadRecord | null;
  /** The thread of the open discard confirmation. */
  readonly discard: ThreadRecord | null;
}

/** The confirmations of the Threads tab: the interrupt of a thread, and the discard of its held entries. */
export function ThreadsTabDialogs({ env, storyId, stages, confirm, discard }: ThreadsTabDialogsProps) {
  if (confirm) {
    return (
      <ConfirmDialog
        title={`${storyId} › Threads › Interrupt`}
        message={`Interrupt ${threadName(confirm, stages)}? The worker stops. Rowbly keeps its session and worktree, and r can resume it later.`}
        confirmLabel="Interrupt"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => confirmInterrupt(env, confirm)}
        onCancel={() => env.setConfirm(null)}
      />
    );
  }

  if (discard) {
    return (
      <ConfirmDialog
        title={`${storyId} › Threads › Discard held entries`}
        message={`Discard the ${env.held[discard.id] ?? 0} held entries of ${threadName(discard, stages)}? The Story files do not change, and you cannot apply the entries later.`}
        confirmLabel="Discard"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => confirmDiscard(env, discard)}
        onCancel={() => env.setDiscard(null)}
      />
    );
  }

  return null;
}
