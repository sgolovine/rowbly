// The factory step that applies the outbox of one worker host and sets an attention entry for each conflict.

import {
  type OutboxConflict,
  type RunInOrder,
  type SyncOutboxResult,
  syncOutbox,
} from "../outbox-apply/outbox-apply.js";
import type { OutboxSource } from "../outbox-apply/outbox-source.js";
import { heldAttention } from "./abandoned-attention.js";
import { abandonedHolds, type ManagerHold } from "./abandoned-threads.js";
import { type Attention, type Manager, serial, setState } from "./manager-state.js";

const VALUE_LIMIT = 200;
const KEY_LIMIT = 128;

/** Gives a value as JSON text, cut to 200 characters. A missing value is `missing`. */
function valueText(value: unknown): string {
  const text = value === undefined ? "missing" : (JSON.stringify(value) ?? String(value));

  return text.length > VALUE_LIMIT ? `${text.slice(0, VALUE_LIMIT)}…` : text;
}

/** Gives the before, after and current values of a field change. */
function valuesText(conflict: OutboxConflict): string {
  return `before ${valueText(conflict.before)}, after ${valueText(conflict.after)}, current ${valueText(conflict.current)}`;
}

/** Gives the text of one conflict: the host, the `seq`, the path or the attachment id, and the values. */
export function conflictText(conflict: OutboxConflict): string {
  const start = `Outbox conflict from host ${conflict.host}, seq ${conflict.seq}`;
  const png = conflict.png ? ` The file is in ${conflict.png}.` : "";

  if (conflict.path) {
    return `${start}, ${conflict.path}: ${valuesText(conflict)}. ${conflict.reason}.`;
  }

  if (conflict.attachmentId) {
    return `${start}, attachment ${conflict.attachmentId}: ${conflict.reason}.${png}`;
  }

  return `${start}: ${conflict.reason}.`;
}

/** The attention key of a conflict: `outbox:<storyId>`, or `outbox:<host>` for an entry without a Story ID. */
function attentionKey(conflict: OutboxConflict): string {
  return `outbox:${conflict.storyId ?? conflict.host}`.slice(0, KEY_LIMIT);
}

/** Gives one attention entry for each Story with a conflict. The text of the entry has each conflict of the Story. */
export function outboxAttention(conflicts: readonly OutboxConflict[]): Map<string, Attention> {
  const keys = [...new Set(conflicts.map(attentionKey))];

  return new Map(
    keys.map((key) => {
      const own = conflicts.filter((conflict) => attentionKey(conflict) === key);
      const storyId = own[0]?.storyId;

      return [key, { text: own.map(conflictText).join("\n"), ...(storyId ? { storyId } : {}) }];
    }),
  );
}

/** Adds the entries to the attention map. A new conflict replaces the text of the entry of its Story. */
function withAttention(
  attention: ReadonlyMap<string, Attention>,
  entries: ReadonlyMap<string, Attention>,
): ReadonlyMap<string, Attention> {
  return new Map([...attention, ...entries]);
}

/**
 * Applies the outbox of one worker host under the Project write lock, in the lifecycle order of the manager. The apply
 * holds the later entries of each abandoned Thread of the host. Then, after the lock is free, it sets the attention
 * entry `outbox:<storyId>` for each Story with a conflict, and `abandoned:<threadId>` for each Thread with new held
 * entries.
 */
export async function syncHostOutbox(manager: Manager, host: string, source: OutboxSource): Promise<SyncOutboxResult> {
  const abandoned = await abandonedHolds(manager, host);
  const result = await syncOutbox({ host, source, inOrder: inLifecycle(manager), abandoned }, manager.ctx);
  const held = await heldAttention(manager.paths, host, result.held ?? [], (id) => storyOfHold(abandoned, id));
  const entries = new Map([...outboxAttention(result.conflicts), ...held]);

  setState(manager, (state) => ({ attention: withAttention(state.attention, entries) }));

  return result;
}

/** Gives the call that runs the locked apply in the lifecycle order of the manager. */
function inLifecycle(manager: Manager): RunInOrder {
  return (call) => serial(manager, call);
}

/** Gives the Story of the abandoned Thread. */
function storyOfHold(holds: readonly ManagerHold[], threadId: string): string | undefined {
  return holds.find((hold) => hold.threadId === threadId)?.storyId;
}
