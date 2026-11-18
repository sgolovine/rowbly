// The manager rules for the attention entry of the problems that a worker reports. This module does no I/O.
import { withEntry, withoutEntry } from "../store/store.js";
import type { ThreadRecord, WorkerResult } from "../thread/thread.js";
import type { Attention } from "./manager-state.js";
import { lastWorkerThreads, NETWORK_ERROR_CODE } from "./network-wait.js";

/** The start of the attention key of a worker Thread that reported a problem or failed. */
export const WORKER_ATTENTION = "worker:";

/** The text limit of `raise_attention`. */
const MAX_TEXT = 1000;
const MAX_ITEMS = 3;
const MAX_ITEM = 150;

/** The facts of the worker Thread that the text names. */
type WorkerThread = Pick<ThreadRecord, "id" | "stage" | "storyId">;

/** The Story fields that the removal rule reads. */
interface WorkerStory {
  readonly id: string;
  readonly stage: string;
}

/** Gives the attention key of the worker entry of a Story. */
export function workerAttentionKey(storyId: string): string {
  return `${WORKER_ATTENTION}${storyId}`;
}

function itemText(item: string): string {
  return item.length > MAX_ITEM ? `${item.slice(0, MAX_ITEM)}…` : item;
}

/** Gives the first items of a list, with the number of the items that the text does not show. */
function listText(label: string, items: readonly string[]): string {
  if (items.length === 0) {
    return "";
  }

  const more = items.length > MAX_ITEMS ? ` (+${items.length - MAX_ITEMS} more)` : "";

  return ` ${label}: ${items.slice(0, MAX_ITEMS).map(itemText).join("; ")}${more}.`;
}

function threadText(thread: WorkerThread): string {
  return `${thread.storyId} in ${thread.stage}: worker ${thread.id}`;
}

/** Gives the text of a reported result with blockers or problems. The text has a maximum of 1000 characters. */
export function resultAttentionText(thread: WorkerThread, result: WorkerResult): string {
  const blockers = listText("Blockers", result.blockers);
  const problems = listText("Problems", result.problems);

  return `${threadText(thread)} ended with outcome ${result.outcome}.${blockers}${problems}`.slice(0, MAX_TEXT);
}

/** Gives the text of a failed worker Thread. The text has a maximum of 1000 characters. */
export function failureAttentionText(thread: WorkerThread, error: NonNullable<ThreadRecord["error"]>): string {
  return `${threadText(thread)} failed (${error.code}): ${error.message}`.slice(0, MAX_TEXT);
}

/**
 * Applies the result that a worker reported. Blockers or problems set the entry `worker:<storyId>`, and a clean
 * result removes it. Without a reported result, the attention does not change.
 */
export function withResultAttention(
  attention: ReadonlyMap<string, Attention>,
  thread: WorkerThread,
  reported: WorkerResult | undefined,
): ReadonlyMap<string, Attention> {
  if (!(reported && thread.storyId)) {
    return attention;
  }

  const key = workerAttentionKey(thread.storyId);

  if (reported.blockers.length === 0 && reported.problems.length === 0) {
    return withoutEntry(attention, key);
  }

  return withEntry(attention, key, { text: resultAttentionText(thread, reported), storyId: thread.storyId });
}

/** Applies a worker failure. A connectivity failure does not set the entry, because the network resume handles it. */
export function withFailureAttention(
  attention: ReadonlyMap<string, Attention>,
  thread: WorkerThread,
  error: NonNullable<ThreadRecord["error"]>,
): ReadonlyMap<string, Attention> {
  if (!thread.storyId || error.code === NETWORK_ERROR_CODE) {
    return attention;
  }

  const text = failureAttentionText(thread, error);

  return withEntry(attention, workerAttentionKey(thread.storyId), { text, storyId: thread.storyId });
}

/** Tells if the worker entry of a Story is stale: the Story is deleted or it left the Stage of its last worker. */
function isStale(storyId: string, stories: ReadonlyMap<string, WorkerStory>, last: ReadonlyMap<string, ThreadRecord>) {
  const story = stories.get(storyId);

  return !story || story.stage !== last.get(storyId)?.stage;
}

/** Removes each `worker:` entry of a Story that is deleted or that is not in the Stage of its last worker Thread. */
export function withoutStaleWorkerAttention(
  attention: ReadonlyMap<string, Attention>,
  stories: readonly WorkerStory[],
  threads: readonly ThreadRecord[],
): ReadonlyMap<string, Attention> {
  const byId = new Map(stories.map((story) => [story.id, story]));
  const last = lastWorkerThreads(threads);

  return new Map(
    [...attention].filter(
      ([key]) => !(key.startsWith(WORKER_ATTENTION) && isStale(key.slice(WORKER_ATTENTION.length), byId, last)),
    ),
  );
}
