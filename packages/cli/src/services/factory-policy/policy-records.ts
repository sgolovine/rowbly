// The factory manager supplies fresh Project and harness facts. This module does no I/O.
import { createHash } from "node:crypto";
import { recordRef, refersToStory, type StoryRef } from "../story/story-ref.js";
import type {
  AttemptStatus,
  PolicyAttempt,
  PolicyLimits,
  PolicyState,
  PolicyStory,
  PolicyWorker,
} from "./policy-types.js";

export const STOPPED_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "blocked", "interrupted"]);
export const FAILURE_STATUSES: ReadonlySet<string> = new Set(["failed", "interrupted"]);
export const MINUTE = 60_000;

export const DEFAULT_LIMITS: PolicyLimits = { attempts: 4, retryMinutes: 2, retryCapMinutes: 60, stallMinutes: 90 };

// The names that harnesses use. An unknown name counts as `running`, because absence of proof is not a stop.
const HARNESS_STATUSES: Record<AttemptStatus, readonly string[]> = {
  preparing: ["preparing", "queued", "pending", "starting"],
  running: ["running", "active", "in_progress", "working", "waiting", "idle", "unknown"],
  completed: ["completed", "complete", "done", "finished", "succeeded", "success"],
  failed: ["failed", "error", "errored", "crashed"],
  blocked: ["blocked"],
  interrupted: [
    "interrupted",
    "cancelled",
    "canceled",
    "stopped",
    "killed",
    "rolled_back",
    "not_found",
    "missing",
    "deleted",
  ],
};

/** Changes a harness status to a status of the state file. Gives `undefined` for a name that it does not know. */
export function normalizeStatus(status: unknown): AttemptStatus | undefined {
  const name = String(status ?? "")
    .trim()
    .toLowerCase()
    .replaceAll(/[\s-]+/g, "_");

  return (Object.keys(HARNESS_STATUSES) as AttemptStatus[]).find((key) => HARNESS_STATUSES[key].includes(name));
}

/** The ID of a worker: the worker ID, the thread ID or the task ID. */
export function workerId(worker: PolicyWorker): string | undefined {
  return worker.workerId ?? worker.threadId ?? worker.taskId;
}

/** Changes when a person or a worker edits the Story. A Stage move does not change it. */
export function storyHash(story: PolicyStory): string {
  const content = JSON.stringify([story.title ?? "", story.description ?? "", story.fields ?? {}]);

  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/** Gives a short hash of a prompt, to find a changed prompt. */
export function promptHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** Gives a copy of the record without the key. */
export function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([entryKey]) => entryKey !== key));
}

/** The reference of an attempt to its Story: the Story ID and, when the attempt has one, the Story `uid`. */
export function attemptRef(attempt: PolicyAttempt): StoryRef {
  return recordRef(attempt.story, attempt.storyUid);
}

/**
 * Tells if the attempt belongs to `story`, by the rule of `matchStoryRef`. `stories` are the known Stories, and
 * `story` is one of them.
 */
export function isAttemptOf<T extends StoryRef>(stories: readonly T[], story: T, attempt: PolicyAttempt): boolean {
  return refersToStory(stories, attemptRef(attempt), story);
}

/**
 * A new budget: the earlier attempts stay in the records, but they no longer count against the limit. Without
 * `stories`, the Story is the only known Story.
 */
export function resetBudget<T extends StoryRef>(
  state: PolicyState,
  story: T,
  stories: readonly T[] = [story],
): PolicyState {
  const attempts = state.attempts.map((attempt) =>
    isAttemptOf(stories, story, attempt) ? { ...attempt, budgetReset: true } : attempt,
  );

  return { ...state, attempts };
}

/** Records a successful launch. Keep each earlier attempt and its report flags. */
export function recordStart(previous: PolicyState, story: string, stage: string, worker: PolicyWorker): PolicyState {
  const id = workerId(worker);

  if (!id) {
    throw new Error("A worker ID is necessary");
  }

  const state = structuredClone(previous);
  const attempts = state.attempts ?? [];

  if (attempts.some((attempt) => attempt.story === story && !STOPPED_STATUSES.has(attempt.status))) {
    throw new Error("The earlier worker has not stopped");
  }

  const attempt: PolicyAttempt = {
    ...worker,
    story,
    stage,
    workerId: id,
    workerType: worker.workerType ?? (worker.taskId ? "subagent" : "thread"),
    startedAt: worker.startedAt ?? new Date().toISOString(),
    stoppedAt: null,
    status: "running",
    result: null,
    reported: false,
    startReported: false,
  };
  const launchFailures = state.launchFailures ? { launchFailures: withoutKey(state.launchFailures, story) } : {};

  return { ...state, attempts: [...attempts, attempt], ...launchFailures };
}

/** Records a launch that gave no worker. The next launch of the Story waits: 2, 4, 8 … 60 minutes. */
export function recordLaunchFailure(
  previous: PolicyState,
  story: string,
  error: unknown,
  now: Date | string = new Date(),
): PolicyState {
  const state = structuredClone(previous);
  const count = (state.launchFailures?.[story]?.count ?? 0) + 1;

  return {
    ...state,
    launchFailures: { ...state.launchFailures, [story]: { count, at: new Date(now).toISOString(), error } },
  };
}

/** Marks the last attempt of the Story as a Stage departure when its worker stopped. */
function markLastDeparture(attempts: PolicyAttempt[], story: StoryRef, stories: readonly StoryRef[]): PolicyAttempt[] {
  const index = attempts.findLastIndex((attempt) => isAttemptOf(stories, story, attempt));
  const last = attempts[index];

  if (!last || !STOPPED_STATUSES.has(last.status)) {
    return attempts;
  }

  return attempts.with(index, { ...last, observedStageDeparture: true });
}

/** The known Stories with `story` first, in place of an equal reference in `stories`. */
function withStory(stories: readonly StoryRef[], story: StoryRef): StoryRef[] {
  return [story, ...stories.filter((other) => other.id !== story.id || other.uid !== story.uid)];
}

/**
 * Makes a Story eligible again after a request from the user. All other assignment checks still apply. The attempts
 * of the Story are found by the rule of `matchStoryRef` among `stories`, the known Stories of the Project.
 */
export function releaseStory(previous: PolicyState, story: StoryRef, stories: readonly StoryRef[] = []): PolicyState {
  const cloned = structuredClone(previous);
  const nativeCancelled = cloned.nativeCancelled as Record<string, unknown> | undefined;
  const state: PolicyState = {
    ...cloned,
    attempts: cloned.attempts ?? [],
    ...(cloned.parked ? { parked: withoutKey(cloned.parked, story.id) } : {}),
    ...(nativeCancelled ? { nativeCancelled: withoutKey(nativeCancelled, story.id) } : {}),
  };
  const known = withStory(stories, story);
  const reset = resetBudget(state, story, known);

  return { ...reset, attempts: markLastDeparture(reset.attempts, story, known) };
}
